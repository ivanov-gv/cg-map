package layers_test

import (
	"bytes"
	"crypto/tls"
	"encoding/binary"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"

	"github.com/ivanov-gv/cg-map/services/backend/internal/layers"
	"github.com/ivanov-gv/cg-map/services/backend/internal/pmtiles"
	"github.com/ivanov-gv/cg-map/services/backend/internal/pmtiles/pmtilestest"
)

const (
	archiveName = "montenegro-0123456789abcdef.pmtiles"
	tilesPrefix = "/api/v1/layers/montenegro-0123456789abcdef/tiles/"
	tileBody    = "vector-tile-12-2267-1513"
	sampleMeta  = `{"name":"Sample","attribution":"© OSM","vector_layers":[` +
		`{"id":"roads","description":"Streets","minzoom":0,"maxzoom":14,"fields":{"class":"String"}},` +
		`{"id":"land"}]}`
)

func newTestArchive(t *testing.T, options pmtilestest.Options, tileData []byte) *pmtiles.Archive {
	t.Helper()
	if options.TileType == pmtiles.TileTypeUnknown {
		options.TileType = pmtiles.TileTypeMVT
	}
	options.InternalCompression = pmtiles.CompressionGzip
	options.MinZoom, options.MaxZoom = 0, 14
	options.MinLon, options.MinLat, options.MaxLon, options.MaxLat = 18.35, 41.75, 20.4, 43.6
	options.CenterZoom, options.CenterLon, options.CenterLat = 14, 19.26, 42.437
	if options.Metadata == "" {
		options.Metadata = sampleMeta
	}
	tiles := []pmtilestest.Tile{{Z: 12, X: 2267, Y: 1513, Data: tileData}}
	data, err := pmtilestest.Build(tiles, options)
	if err != nil {
		t.Fatalf("pmtilestest.Build: %v", err)
	}
	archive, err := pmtiles.NewArchive(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("NewArchive: %v", err)
	}
	return archive
}

func newTestHandler(t *testing.T, tileCompression pmtiles.Compression) http.Handler {
	t.Helper()
	tileData := []byte(tileBody)
	if tileCompression == pmtiles.CompressionGzip {
		tileData = pmtilestest.Gzip(tileData)
	}
	archive := newTestArchive(t, pmtilestest.Options{TileCompression: tileCompression}, tileData)
	handler, err := layers.NewHandler(archive, archiveName)
	if err != nil {
		t.Fatalf("NewHandler: %v", err)
	}
	return handler
}

func TestTileJSON(t *testing.T) {
	tests := []struct {
		name      string
		configure func(r *http.Request)
		wantTiles string
	}{
		{"plain http", func(r *http.Request) {}, "http://maps.example/api/v1/layers/montenegro-0123456789abcdef/tiles/{z}/{x}/{y}.mvt"},
		{"tls", func(r *http.Request) { r.TLS = &tls.ConnectionState{} }, "https://maps.example/api/v1/layers/montenegro-0123456789abcdef/tiles/{z}/{x}/{y}.mvt"},
		{"forwarded https", func(r *http.Request) { r.Header.Set("X-Forwarded-Proto", "https") }, "https://maps.example/api/v1/layers/montenegro-0123456789abcdef/tiles/{z}/{x}/{y}.mvt"},
	}
	handler := newTestHandler(t, pmtiles.CompressionGzip)
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "http://maps.example/api/v1/layers", nil)
			test.configure(request)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)

			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, body %s", response.Code, response.Body)
			}
			assertHeaders(t, response, map[string]string{
				"Content-Type":           "application/json",
				"Cache-Control":          "public, max-age=300",
				"Vary":                   "X-Forwarded-Proto",
				"X-Content-Type-Options": "nosniff",
			})
			var document struct {
				TileJSON     string    `json:"tilejson"`
				Name         string    `json:"name"`
				Tiles        []string  `json:"tiles"`
				MinZoom      int       `json:"minzoom"`
				MaxZoom      int       `json:"maxzoom"`
				Bounds       []float64 `json:"bounds"`
				Center       []float64 `json:"center"`
				Attribution  string    `json:"attribution"`
				VectorLayers []struct {
					ID          string            `json:"id"`
					Description string            `json:"description"`
					MinZoom     *int              `json:"minzoom"`
					MaxZoom     *int              `json:"maxzoom"`
					Fields      map[string]string `json:"fields"`
				} `json:"vector_layers"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &document); err != nil {
				t.Fatalf("json: %v", err)
			}
			if document.TileJSON != "3.0.0" || document.Name != "Sample" || document.Attribution != "© OSM" {
				t.Errorf("document = %+v", document)
			}
			if len(document.Tiles) != 1 || document.Tiles[0] != test.wantTiles {
				t.Errorf("tiles = %v, want %s", document.Tiles, test.wantTiles)
			}
			if document.MinZoom != 0 || document.MaxZoom != 14 {
				t.Errorf("zoom = %d..%d", document.MinZoom, document.MaxZoom)
			}
			if !equalFloats(document.Bounds, []float64{18.35, 41.75, 20.4, 43.6}) || !equalFloats(document.Center, []float64{19.26, 42.437, 14}) {
				t.Errorf("bounds = %v, center = %v", document.Bounds, document.Center)
			}
			if len(document.VectorLayers) != 2 {
				t.Fatalf("vector_layers = %+v", document.VectorLayers)
			}
			roads, land := document.VectorLayers[0], document.VectorLayers[1]
			if roads.ID != "roads" || roads.Description != "Streets" || roads.MinZoom == nil || *roads.MinZoom != 0 ||
				roads.MaxZoom == nil || *roads.MaxZoom != 14 || roads.Fields["class"] != "String" {
				t.Errorf("roads layer = %+v", roads)
			}
			if land.ID != "land" || land.Fields == nil || land.MinZoom != nil {
				t.Errorf("land layer = %+v (fields must default to {})", land)
			}
		})
	}
}

func TestTile(t *testing.T) {
	gzipped := pmtilestest.Gzip([]byte(tileBody))
	tests := []struct {
		name            string
		compression     pmtiles.Compression
		method          string
		path            string
		acceptEncoding  string
		wantStatus      int
		wantBody        []byte
		wantEncoding    string
		wantContentType string
	}{
		{"gzip stored, gzip accepted", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "12/2267/1513.mvt", "gzip, deflate, br", http.StatusOK, gzipped, "gzip", "application/vnd.mapbox-vector-tile"},
		{"gzip stored, no Accept-Encoding", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "12/2267/1513.mvt", "", http.StatusOK, []byte(tileBody), "", "application/vnd.mapbox-vector-tile"},
		{"gzip stored, gzip refused", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "12/2267/1513.mvt", "gzip;q=0, br", http.StatusOK, []byte(tileBody), "", "application/vnd.mapbox-vector-tile"},
		{"gzip stored, wildcard", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "12/2267/1513.mvt", "*", http.StatusOK, gzipped, "gzip", "application/vnd.mapbox-vector-tile"},
		{"uncompressed stored, gzip accepted", pmtiles.CompressionNone, http.MethodGet, tilesPrefix + "12/2267/1513.mvt", "gzip", http.StatusOK, []byte(tileBody), "", "application/vnd.mapbox-vector-tile"},
		{"head", pmtiles.CompressionGzip, http.MethodHead, tilesPrefix + "12/2267/1513.mvt", "gzip", http.StatusOK, nil, "gzip", "application/vnd.mapbox-vector-tile"},
		{"missing tile in range", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "12/2267/1514.mvt", "gzip", http.StatusNoContent, nil, "", ""},
		{"zoom above archive", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "15/0/0.mvt", "", http.StatusNotFound, nil, "", "application/json"},
		{"x outside zoom grid", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "1/2/0.mvt", "", http.StatusNotFound, nil, "", "application/json"},
		{"non-numeric x", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "12/abc/1513.mvt", "", http.StatusBadRequest, nil, "", "application/json"},
		{"negative y", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "12/2267/-1.mvt", "", http.StatusBadRequest, nil, "", "application/json"},
		{"zoom overflows uint8", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "300/0/0.mvt", "", http.StatusBadRequest, nil, "", "application/json"},
		{"leading zero z", pmtiles.CompressionGzip, http.MethodGet, "/api/v1/layers/montenegro-0123456789abcdef/tiles/012/2267/1513.mvt", "", http.StatusBadRequest, nil, "", "application/json"},
		{"leading zero y", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "12/2267/01513.mvt", "", http.StatusBadRequest, nil, "", "application/json"},
		{"zero is canonical", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "0/0/0.mvt", "", http.StatusNoContent, nil, "", ""},
		{"old release token", pmtiles.CompressionGzip, http.MethodGet, "/api/v1/layers/montenegro-old/tiles/12/2267/1513.mvt", "", http.StatusNotFound, nil, "", "application/json"},
		{"wrong extension", pmtiles.CompressionGzip, http.MethodGet, tilesPrefix + "12/2267/1513.png", "", http.StatusBadRequest, nil, "", "application/json"},
		{"unknown path", pmtiles.CompressionGzip, http.MethodGet, "/api/v1/layers/other", "", http.StatusNotFound, nil, "", "application/json"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler := newTestHandler(t, test.compression)
			request := httptest.NewRequest(test.method, test.path, nil)
			if test.acceptEncoding != "" {
				request.Header.Set("Accept-Encoding", test.acceptEncoding)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)

			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d; body %s", response.Code, test.wantStatus, response.Body)
			}
			assertHeaders(t, response, map[string]string{
				"Content-Type":           test.wantContentType,
				"Content-Encoding":       test.wantEncoding,
				"X-Content-Type-Options": "nosniff",
			})
			if test.wantStatus >= 400 {
				assertJSONError(t, response)
				return
			}
			assertHeaders(t, response, map[string]string{
				"Vary":          "Accept-Encoding",
				"Cache-Control": "public, max-age=31536000, immutable",
			})
			if test.wantBody != nil && !bytes.Equal(response.Body.Bytes(), test.wantBody) {
				t.Errorf("body = %q, want %q", response.Body.Bytes(), test.wantBody)
			}
			if test.wantBody == nil && response.Body.Len() != 0 {
				t.Errorf("body = %q, want empty", response.Body.Bytes())
			}
		})
	}
}

func TestTileETag(t *testing.T) {
	handler := newTestHandler(t, pmtiles.CompressionGzip)
	get := func(acceptEncoding, ifNoneMatch string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, tilesPrefix+"12/2267/1513.mvt", nil)
		request.Header.Set("Accept-Encoding", acceptEncoding)
		if ifNoneMatch != "" {
			request.Header.Set("If-None-Match", ifNoneMatch)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		return response
	}

	gzipETag := get("gzip", "").Header().Get("ETag")
	identityETag := get("identity", "").Header().Get("ETag")
	if gzipETag == "" || gzipETag == identityETag {
		t.Fatalf("ETags must exist and differ per encoding: gzip %q, identity %q", gzipETag, identityETag)
	}

	tests := []struct {
		name           string
		acceptEncoding string
		ifNoneMatch    string
		wantStatus     int
	}{
		{"matching", "gzip", gzipETag, http.StatusNotModified},
		{"weak matching in list", "gzip", `"other", W/` + gzipETag, http.StatusNotModified},
		{"wildcard", "gzip", "*", http.StatusNotModified},
		{"other encoding", "identity", gzipETag, http.StatusOK},
		{"stale", "gzip", `"montenegro-old.pmtiles-1-gzip"`, http.StatusOK},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := get(test.acceptEncoding, test.ifNoneMatch)
			if response.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", response.Code, test.wantStatus)
			}
			if test.wantStatus == http.StatusNotModified && response.Body.Len() != 0 {
				t.Errorf("304 with body %q", response.Body)
			}
			if response.Header().Get("Cache-Control") != "public, max-age=31536000, immutable" || response.Header().Get("Vary") != "Accept-Encoding" {
				t.Errorf("headers = %v", response.Header())
			}
		})
	}
}

func TestMethodNotAllowed(t *testing.T) {
	handler := newTestHandler(t, pmtiles.CompressionGzip)
	for _, path := range []string{"/api/v1/layers", tilesPrefix + "12/2267/1513.mvt"} {
		for _, method := range []string{http.MethodPost, http.MethodPut, http.MethodDelete} {
			request := httptest.NewRequest(method, path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusMethodNotAllowed || response.Header().Get("Allow") != "GET, HEAD" {
				t.Errorf("%s %s: status %d, Allow %q", method, path, response.Code, response.Header().Get("Allow"))
			}
			assertJSONError(t, response)
		}
	}
}

func TestNewHandlerRejects(t *testing.T) {
	tests := []struct {
		name    string
		options pmtilestest.Options
		want    error
	}{
		{"raster archive", pmtilestest.Options{TileType: pmtiles.TileTypePNG, TileCompression: pmtiles.CompressionNone}, layers.ErrUnsupportedTileType},
		{"brotli tiles", pmtilestest.Options{TileCompression: pmtiles.CompressionBrotli}, layers.ErrUnsupportedTileCompression},
		{"metadata not an object", pmtilestest.Options{TileCompression: pmtiles.CompressionGzip, Metadata: `["x"]`}, layers.ErrInvalidMetadata},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			archive := newTestArchive(t, test.options, []byte("tile"))
			_, err := layers.NewHandler(archive, archiveName)
			if !errors.Is(err, test.want) {
				t.Fatalf("err = %v, want %v", err, test.want)
			}
		})
	}
}

func TestTileJSONRelease(t *testing.T) {
	tileURL := func(handler http.Handler) string {
		request := httptest.NewRequest(http.MethodGet, "http://maps.example/api/v1/layers", nil)
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		var document struct {
			Tiles []string `json:"tiles"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &document); err != nil || len(document.Tiles) != 1 {
			t.Fatalf("tilejson: %s (%v)", response.Body, err)
		}
		return document.Tiles[0]
	}
	archive := newTestArchive(t, pmtilestest.Options{TileCompression: pmtiles.CompressionNone}, []byte(tileBody))
	oldHandler, err := layers.NewHandler(archive, "montenegro-aaaaaaaaaaaaaaaa.pmtiles")
	if err != nil {
		t.Fatal(err)
	}
	newHandler, err := layers.NewHandler(archive, "montenegro-bbbbbbbbbbbbbbbb.pmtiles")
	if err != nil {
		t.Fatal(err)
	}

	// each release advertises its own tile URLs
	if got, want := tileURL(oldHandler), "http://maps.example/api/v1/layers/montenegro-aaaaaaaaaaaaaaaa/tiles/{z}/{x}/{y}.mvt"; got != want {
		t.Errorf("old release tiles = %s, want %s", got, want)
	}
	if got, want := tileURL(newHandler), "http://maps.example/api/v1/layers/montenegro-bbbbbbbbbbbbbbbb/tiles/{z}/{x}/{y}.mvt"; got != want {
		t.Errorf("new release tiles = %s, want %s", got, want)
	}

	// the new release serves its own token and refuses the old one
	for path, wantStatus := range map[string]int{
		"/api/v1/layers/montenegro-bbbbbbbbbbbbbbbb/tiles/12/2267/1513.mvt": http.StatusOK,
		"/api/v1/layers/montenegro-aaaaaaaaaaaaaaaa/tiles/12/2267/1513.mvt": http.StatusNotFound,
	} {
		response := httptest.NewRecorder()
		newHandler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != wantStatus {
			t.Errorf("%s: status %d, want %d", path, response.Code, wantStatus)
		}
	}
}

func TestTileJSONPublicURL(t *testing.T) {
	tests := []struct {
		name      string
		publicURL string
		wantTiles string
	}{
		{"origin", "https://maps.example", "https://maps.example/api/v1/layers/montenegro-0123456789abcdef/tiles/{z}/{x}/{y}.mvt"},
		{"trailing slash and path prefix", "https://example.org/kompas/", "https://example.org/kompas/api/v1/layers/montenegro-0123456789abcdef/tiles/{z}/{x}/{y}.mvt"},
	}
	archive := newTestArchive(t, pmtilestest.Options{TileCompression: pmtiles.CompressionGzip}, pmtilestest.Gzip([]byte(tileBody)))
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler, err := layers.NewHandler(archive, archiveName, layers.WithPublicURL(test.publicURL))
			if err != nil {
				t.Fatalf("NewHandler: %v", err)
			}
			// the request's Host and forwarded scheme are ignored
			request := httptest.NewRequest(http.MethodGet, "http://attacker.example/api/v1/layers", nil)
			request.Header.Set("X-Forwarded-Proto", "http")
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			var document struct {
				Tiles []string `json:"tiles"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &document); err != nil {
				t.Fatal(err)
			}
			if len(document.Tiles) != 1 || document.Tiles[0] != test.wantTiles {
				t.Errorf("tiles = %v, want %s", document.Tiles, test.wantTiles)
			}
			if vary := response.Header().Get("Vary"); vary != "" {
				t.Errorf("Vary = %q, want none with a fixed public URL", vary)
			}
		})
	}

	for _, invalid := range []string{"maps.example", "ftp://maps.example", "https://maps.example/?a=1", "https://maps.example/#x", "https://"} {
		_, err := layers.NewHandler(archive, archiveName, layers.WithPublicURL(invalid))
		if !errors.Is(err, layers.ErrInvalidPublicURL) {
			t.Errorf("WithPublicURL(%q): err = %v, want ErrInvalidPublicURL", invalid, err)
		}
	}
}

func TestTileJSONHead(t *testing.T) {
	handler := newTestHandler(t, pmtiles.CompressionGzip)
	get := httptest.NewRecorder()
	handler.ServeHTTP(get, httptest.NewRequest(http.MethodGet, "/api/v1/layers", nil))
	head := httptest.NewRecorder()
	handler.ServeHTTP(head, httptest.NewRequest(http.MethodHead, "/api/v1/layers", nil))

	if head.Code != http.StatusOK || head.Body.Len() != 0 {
		t.Fatalf("HEAD: status %d, body %q", head.Code, head.Body)
	}
	if want := strconv.Itoa(get.Body.Len()); head.Header().Get("Content-Length") != want {
		t.Errorf("HEAD Content-Length = %q, want %s", head.Header().Get("Content-Length"), want)
	}
	assertHeaders(t, head, map[string]string{
		"Content-Type":  "application/json",
		"Cache-Control": "public, max-age=300",
		"Vary":          "X-Forwarded-Proto",
	})
}

func TestTileConditionalEdgeCases(t *testing.T) {
	handler := newTestHandler(t, pmtiles.CompressionGzip)
	etagOf := func(method, path string) string {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(method, path, nil)
		request.Header.Set("Accept-Encoding", "gzip")
		handler.ServeHTTP(response, request)
		return response.Header().Get("ETag")
	}
	tests := []struct {
		name   string
		method string
		path   string
	}{
		{"missing tile (204)", http.MethodGet, tilesPrefix + "12/2267/1514.mvt"},
		{"head", http.MethodHead, tilesPrefix + "12/2267/1513.mvt"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			etag := etagOf(test.method, test.path)
			if etag == "" {
				t.Fatal("no ETag")
			}
			request := httptest.NewRequest(test.method, test.path, nil)
			request.Header.Set("Accept-Encoding", "gzip")
			request.Header.Set("If-None-Match", etag)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusNotModified || response.Body.Len() != 0 {
				t.Fatalf("status %d, body %q; want empty 304", response.Code, response.Body)
			}
			assertHeaders(t, response, map[string]string{
				"ETag":          etag,
				"Vary":          "Accept-Encoding",
				"Cache-Control": "public, max-age=31536000, immutable",
			})
		})
	}
}

func TestTileServerErrors(t *testing.T) {
	tests := []struct {
		name           string
		build          func(t *testing.T) *pmtiles.Archive
		acceptEncoding string
	}{
		{
			name: "stored tile is not gzip, client needs identity",
			build: func(t *testing.T) *pmtiles.Archive {
				return newTestArchive(t, pmtilestest.Options{TileCompression: pmtiles.CompressionGzip}, []byte(tileBody))
			},
		},
		{
			name: "gzip size field above the decompression limit, client needs identity",
			build: func(t *testing.T) *pmtiles.Archive {
				return newTestArchive(t, pmtilestest.Options{TileCompression: pmtiles.CompressionGzip}, pmtilestest.Gzip(make([]byte, 9<<20)))
			},
		},
		{
			name: "tile entry outside tile data",
			build: func(t *testing.T) *pmtiles.Archive {
				data, err := pmtilestest.Build([]pmtilestest.Tile{{Z: 12, X: 2267, Y: 1513, Data: []byte(tileBody)}},
					pmtilestest.Options{TileType: pmtiles.TileTypeMVT, TileCompression: pmtiles.CompressionGzip, MaxZoom: 14, Metadata: sampleMeta})
				if err != nil {
					t.Fatal(err)
				}
				// shrink the tile data section below the entry
				binary.LittleEndian.PutUint64(data[64:], 1)
				archive, err := pmtiles.NewArchive(bytes.NewReader(data), int64(len(data)))
				if err != nil {
					t.Fatal(err)
				}
				return archive
			},
			acceptEncoding: "gzip",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler, err := layers.NewHandler(test.build(t), archiveName)
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest(http.MethodGet, tilesPrefix+"12/2267/1513.mvt", nil)
			if test.acceptEncoding != "" {
				request.Header.Set("Accept-Encoding", test.acceptEncoding)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != http.StatusInternalServerError {
				t.Fatalf("status %d, want 500", response.Code)
			}
			assertJSONError(t, response)
			assertHeaders(t, response, map[string]string{
				"Cache-Control":    "no-store",
				"ETag":             "",
				"Content-Encoding": "",
			})
		})
	}
}

func TestTileTruncationLogged(t *testing.T) {
	var logs bytes.Buffer
	log.SetOutput(&logs)
	defer log.SetOutput(os.Stderr)

	// two gzip members: 9 MiB of zeros, then one byte; the trailing size field declares 1 byte
	tileData := append(pmtilestest.Gzip(make([]byte, 9<<20)), pmtilestest.Gzip([]byte("x"))...)
	archive := newTestArchive(t, pmtilestest.Options{TileCompression: pmtiles.CompressionGzip}, tileData)
	handler, err := layers.NewHandler(archive, archiveName)
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, tilesPrefix+"12/2267/1513.mvt", nil))

	// the status was already sent, so the body stops at the limit and the truncation is logged
	if response.Code != http.StatusOK || response.Body.Len() != 8<<20 {
		t.Fatalf("status %d, body %d bytes; want 200 with %d bytes", response.Code, response.Body.Len(), 8<<20)
	}
	if !strings.Contains(logs.String(), "z=12, x=2267, y=1513") || !strings.Contains(logs.String(), "truncated") {
		t.Errorf("log = %q, want a truncation message with tile coordinates", logs.String())
	}

	// a tile within the limit logs nothing
	logs.Reset()
	handler = newTestHandler(t, pmtiles.CompressionGzip)
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, tilesPrefix+"12/2267/1513.mvt", nil))
	if response.Body.String() != tileBody || logs.Len() != 0 {
		t.Errorf("body %q, log %q", response.Body, logs.String())
	}
}

func TestNewHandlerArchiveName(t *testing.T) {
	archive := newTestArchive(t, pmtilestest.Options{TileCompression: pmtiles.CompressionNone}, []byte(tileBody))
	// content-addressed release names are accepted
	for _, name := range []string{"montenegro-d4f4f7de5f0ccb10.pmtiles", "podgorica_v2-0000000000000000.pmtiles"} {
		if _, err := layers.NewHandler(archive, name); err != nil {
			t.Errorf("NewHandler(%q): %v", name, err)
		}
	}
	for _, name := range []string{
		"", ".pmtiles", "x.pmtiles", "montenegro.pmtiles",
		"montenegro-d4f4f7de5f0ccb1.pmtiles",   // 15 hex digits
		"montenegro-d4f4f7de5f0ccb100.pmtiles", // 17 hex digits
		"montenegro-D4F4F7DE5F0CCB10.pmtiles",  // uppercase
		"montenegro-d4f4f7de5f0ccb10.mbtiles",
		"montenegro-d4f4f7de5f0ccb10",
		"d4f4f7de5f0ccb10.pmtiles", "-d4f4f7de5f0ccb10.pmtiles",
		"a/b-d4f4f7de5f0ccb10.pmtiles", "../x-d4f4f7de5f0ccb10.pmtiles", `q"-d4f4f7de5f0ccb10.pmtiles`,
	} {
		_, err := layers.NewHandler(archive, name)
		if !errors.Is(err, layers.ErrInvalidArchiveName) {
			t.Errorf("NewHandler(%q): err = %v, want ErrInvalidArchiveName", name, err)
		}
	}
}

func assertHeaders(t *testing.T, response *httptest.ResponseRecorder, want map[string]string) {
	t.Helper()
	for name, value := range want {
		if got := response.Header().Get(name); got != value {
			t.Errorf("header %s = %q, want %q", name, got, value)
		}
	}
}

func assertJSONError(t *testing.T, response *httptest.ResponseRecorder) {
	t.Helper()
	var body struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil || body.Error == "" {
		t.Errorf("error body = %q (%v)", response.Body, err)
	}
	if response.Header().Get("Content-Type") != "application/json" {
		t.Errorf("error Content-Type = %q", response.Header().Get("Content-Type"))
	}
}

func equalFloats(got, want []float64) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
