// Package layers serves map layers from a PMTiles archive as TileJSON and vector tiles.
package layers

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/ivanov-gv/cg-map/services/backend/internal/pmtiles"
)

// NewHandler serves GET /api/v1/layers (TileJSON for the current release) and
// GET /api/v1/layers/{release}/tiles/{z}/{x}/{y}.mvt from an MVT archive.
// archiveName must be content-addressed (e.g. "montenegro-d4f4f7de5f0ccb10.pmtiles"): its name without
// the .pmtiles extension is the release token in tile URLs, which lets tiles be cached as immutable.
func NewHandler(archive *pmtiles.Archive, archiveName string, opts ...Option) (http.Handler, error) {
	// apply options
	var _options options
	for _, opt := range opts {
		opt(&_options)
	}
	publicURL, err := normalizePublicURL(_options.publicURL)
	if err != nil {
		return nil, fmt.Errorf("normalizePublicURL [public_url='%s']: %w", _options.publicURL, err)
	}

	// immutable tile caching is only safe for content-addressed names; the token goes into URLs and ETags unescaped
	if !releaseArchiveName.MatchString(archiveName) {
		return nil, fmt.Errorf("NewHandler [archive='%s']: %w", archiveName, ErrInvalidArchiveName)
	}
	release := strings.TrimSuffix(archiveName, archiveExtension)

	// accept only vector tiles we can serve as stored or gunzip
	header := archive.Header()
	if header.TileType != pmtiles.TileTypeMVT {
		return nil, fmt.Errorf("NewHandler [archive='%s', tile_type=%s]: %w", archiveName, header.TileType, ErrUnsupportedTileType)
	}
	if header.TileCompression != pmtiles.CompressionNone && header.TileCompression != pmtiles.CompressionGzip {
		return nil, fmt.Errorf("NewHandler [archive='%s', tile_compression=%s]: %w", archiveName, header.TileCompression, ErrUnsupportedTileCompression)
	}

	// read metadata once
	rawMetadata, err := archive.Metadata()
	if err != nil {
		return nil, fmt.Errorf("archive.Metadata [archive='%s']: %w", archiveName, err)
	}
	var _metadata metadata
	err = json.Unmarshal(rawMetadata, &_metadata)
	if err != nil {
		return nil, fmt.Errorf("json.Unmarshal metadata [archive='%s']: %w: %w", archiveName, ErrInvalidMetadata, err)
	}

	h := &handler{
		archive:    archive,
		release:    release,
		publicURL:  publicURL,
		gzipStored: header.TileCompression == pmtiles.CompressionGzip,
		minZoom:    header.MinZoom,
		maxZoom:    header.MaxZoom,
		tileJSON:   newTileJSON(header, _metadata, release),
	}

	mux := http.NewServeMux()
	mux.HandleFunc(tileJSONPath, h.serveTileJSON)
	mux.HandleFunc(tilePattern, h.serveTile)
	mux.HandleFunc(tileJSONPath+"/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	return withNoSniff(mux), nil
}

type handler struct {
	archive    *pmtiles.Archive
	release    string
	publicURL  string // empty: derive scheme and host from the request
	gzipStored bool
	minZoom    uint8
	maxZoom    uint8
	tileJSON   tileJSON
}

// metadata is the subset of PMTiles JSON metadata exposed through TileJSON
type metadata struct {
	Name         string        `json:"name"`
	Description  string        `json:"description"`
	Attribution  string        `json:"attribution"`
	VectorLayers []vectorLayer `json:"vector_layers"`
}

type vectorLayer struct {
	ID          string          `json:"id"`
	Description string          `json:"description,omitempty"`
	MinZoom     *int            `json:"minzoom,omitempty"`
	MaxZoom     *int            `json:"maxzoom,omitempty"`
	Fields      json.RawMessage `json:"fields"`
}

type tileJSON struct {
	TileJSON     string        `json:"tilejson"`
	Name         string        `json:"name"`
	Description  string        `json:"description,omitempty"`
	Attribution  string        `json:"attribution,omitempty"`
	Scheme       string        `json:"scheme"`
	Tiles        []string      `json:"tiles"`
	MinZoom      uint8         `json:"minzoom"`
	MaxZoom      uint8         `json:"maxzoom"`
	Bounds       [4]float64    `json:"bounds"`
	Center       [3]float64    `json:"center"`
	VectorLayers []vectorLayer `json:"vector_layers"`
}

func newTileJSON(header pmtiles.Header, _metadata metadata, release string) tileJSON {
	name := _metadata.Name
	if name == "" {
		name = release
	}
	// TileJSON 3.0.0 requires vector_layers and per-layer fields
	vectorLayers := make([]vectorLayer, 0, len(_metadata.VectorLayers))
	for _, layer := range _metadata.VectorLayers {
		if len(layer.Fields) == 0 || string(layer.Fields) == "null" {
			layer.Fields = json.RawMessage("{}")
		}
		vectorLayers = append(vectorLayers, layer)
	}
	return tileJSON{
		TileJSON:     tileJSONVersion,
		Name:         name,
		Description:  _metadata.Description,
		Attribution:  _metadata.Attribution,
		Scheme:       "xyz",
		MinZoom:      header.MinZoom,
		MaxZoom:      header.MaxZoom,
		Bounds:       [4]float64{header.MinLon, header.MinLat, header.MaxLon, header.MaxLat},
		Center:       [3]float64{header.CenterLon, header.CenterLat, float64(header.CenterZoom)},
		VectorLayers: vectorLayers,
	}
}

// serveTileJSON writes TileJSON whose tile URL template points at the current release
func (h *handler) serveTileJSON(w http.ResponseWriter, r *http.Request) {
	if !allowRead(w, r) {
		return
	}

	// absolute tile URL from the configured public URL, or from the request
	base := h.publicURL
	if base == "" {
		base = requestScheme(r) + "://" + r.Host
		// the tile URL depends on the forwarded scheme
		w.Header().Set("Vary", "X-Forwarded-Proto")
	}
	document := h.tileJSON
	document.Tiles = []string{base + tileJSONPath + "/" + h.release + "/tiles/{z}/{x}/{y}" + tileExtension}
	body, err := json.Marshal(document)
	if err != nil {
		log.Printf("layers: json.Marshal tilejson: %v", err)
		writeError(w, http.StatusInternalServerError, "internal error")
		return
	}

	w.Header().Set("Content-Type", contentTypeJSON)
	w.Header().Set("Cache-Control", cacheControlTileJSON)
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(body)
	}
}

// serveTile writes one vector tile: gzip as stored when accepted, otherwise identity
func (h *handler) serveTile(w http.ResponseWriter, r *http.Request) {
	if !allowRead(w, r) {
		return
	}

	// tiles of other releases are gone: their URLs were cached as immutable
	if r.PathValue("release") != h.release {
		writeError(w, http.StatusNotFound, "unknown release")
		return
	}

	// parse z/x/y; malformed numbers are 400, coordinates outside the archive are 404
	z, x, y, ok := parseTileCoordinates(r.PathValue("z"), r.PathValue("x"), r.PathValue("file"))
	if !ok {
		writeError(w, http.StatusBadRequest, "tile path must be /{z}/{x}/{y}.mvt with non-negative integers without leading zeros")
		return
	}
	if z < h.minZoom || z > h.maxZoom {
		writeError(w, http.StatusNotFound, "zoom outside archive range")
		return
	}
	tileID, err := pmtiles.ZxyToID(z, x, y)
	if err != nil {
		writeError(w, http.StatusNotFound, "tile coordinates outside zoom grid")
		return
	}

	// conditional request: the representation depends on the negotiated encoding
	sendGzip := h.gzipStored && acceptsGzip(r.Header.Get("Accept-Encoding"))
	etag := h.etag(tileID, sendGzip)
	w.Header().Set("Vary", "Accept-Encoding")
	w.Header().Set("Cache-Control", cacheControlTile)
	w.Header().Set("ETag", etag)
	if matchesETag(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	// read the tile as stored
	data, found, err := h.archive.Tile(z, x, y)
	if err != nil {
		log.Printf("layers: archive.Tile [z=%d, x=%d, y=%d]: %v", z, x, y, err)
		writeError(w, http.StatusInternalServerError, "tile read failed")
		return
	}
	if !found {
		// MapLibre renders 204 as an empty tile
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// stream-decode for clients that cannot take gzip
	if h.gzipStored && !sendGzip {
		h.writeGunzipped(w, r, data, z, x, y)
		return
	}
	if sendGzip {
		w.Header().Set("Content-Encoding", "gzip")
	}
	w.Header().Set("Content-Type", contentTypeMVT)
	w.Header().Set("Content-Length", strconv.Itoa(len(data)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(data)
	}
}

// writeGunzipped streams a gzip tile decoded, bounded by maxTileDecompressedLength
func (h *handler) writeGunzipped(w http.ResponseWriter, r *http.Request, data []byte, z uint8, x, y uint32) {
	// validate the gzip header and the declared size before committing to 200
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		log.Printf("layers: gzip.NewReader [z=%d, x=%d, y=%d]: %v", z, x, y, err)
		writeError(w, http.StatusInternalServerError, "tile decode failed")
		return
	}
	defer reader.Close()
	if declared := binary.LittleEndian.Uint32(data[len(data)-4:]); declared > maxTileDecompressedLength {
		log.Printf("layers: tile [z=%d, x=%d, y=%d] declares %d decompressed bytes, limit %d", z, x, y, declared, maxTileDecompressedLength)
		writeError(w, http.StatusInternalServerError, "tile decode failed")
		return
	}

	w.Header().Set("Content-Type", contentTypeMVT)
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	// the status is sent; failures can only be logged
	copied, err := io.Copy(w, io.LimitReader(reader, maxTileDecompressedLength))
	if err != nil {
		log.Printf("layers: gunzip stream [z=%d, x=%d, y=%d, copied=%d]: %v", z, x, y, copied, err)
		return
	}
	// a lying size field or extra gzip members can exceed the limit: the client got a truncated tile
	if copied == maxTileDecompressedLength {
		extra, _ := io.ReadFull(reader, make([]byte, 1))
		if extra > 0 {
			log.Printf("layers: gunzip stream [z=%d, x=%d, y=%d]: tile truncated at %d bytes (declared size %d)",
				z, x, y, maxTileDecompressedLength, binary.LittleEndian.Uint32(data[len(data)-4:]))
		}
	}
}

func (h *handler) etag(tileID uint64, gzipped bool) string {
	encoding := "identity"
	if gzipped {
		encoding = "gzip"
	}
	return fmt.Sprintf(`"%s-%d-%s"`, h.release, tileID, encoding)
}

// parseTileCoordinates parses z, x and "<y>.mvt" in canonical decimal form
func parseTileCoordinates(zText, xText, file string) (z uint8, x, y uint32, ok bool) {
	yText, hasExtension := strings.CutSuffix(file, tileExtension)
	if !hasExtension {
		return 0, 0, 0, false
	}
	zValue, zOK := parseCoordinate(zText, 8)
	xValue, xOK := parseCoordinate(xText, 32)
	yValue, yOK := parseCoordinate(yText, 32)
	if !zOK || !xOK || !yOK {
		return 0, 0, 0, false
	}
	return uint8(zValue), uint32(xValue), uint32(yValue), true
}

// parseCoordinate accepts only canonical unsigned decimals, so each tile has one URL
func parseCoordinate(text string, bitSize int) (uint64, bool) {
	if len(text) > 1 && text[0] == '0' {
		return 0, false
	}
	value, err := strconv.ParseUint(text, 10, bitSize)
	return value, err == nil
}

// allowRead permits GET and HEAD and answers 405 otherwise
func allowRead(w http.ResponseWriter, r *http.Request) bool {
	if r.Method == http.MethodGet || r.Method == http.MethodHead {
		return true
	}
	w.Header().Set("Allow", "GET, HEAD")
	writeError(w, http.StatusMethodNotAllowed, "method not allowed")
	return false
}

// requestScheme prefers the TLS state, then a proxy's X-Forwarded-Proto
func requestScheme(r *http.Request) string {
	if r.TLS != nil {
		return "https"
	}
	forwarded, _, _ := strings.Cut(r.Header.Get("X-Forwarded-Proto"), ",")
	if strings.EqualFold(strings.TrimSpace(forwarded), "https") {
		return "https"
	}
	return "http"
}

// acceptsGzip reports whether Accept-Encoding allows gzip (explicitly or via *) with a non-zero q
func acceptsGzip(acceptEncoding string) bool {
	gzipQuality, wildcardQuality := -1.0, -1.0
	for _, part := range strings.Split(acceptEncoding, ",") {
		coding, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		quality := 1.0
		for _, param := range strings.Split(params, ";") {
			key, value, _ := strings.Cut(strings.TrimSpace(param), "=")
			if strings.EqualFold(key, "q") {
				parsed, err := strconv.ParseFloat(value, 64)
				if err != nil {
					parsed = 0
				}
				quality = parsed
			}
		}
		switch strings.ToLower(strings.TrimSpace(coding)) {
		case "gzip", "x-gzip":
			gzipQuality = quality
		case "*":
			wildcardQuality = quality
		}
	}
	if gzipQuality >= 0 {
		return gzipQuality > 0
	}
	return wildcardQuality > 0
}

// matchesETag implements the weak comparison used by If-None-Match
func matchesETag(ifNoneMatch, etag string) bool {
	for _, candidate := range strings.Split(ifNoneMatch, ",") {
		candidate = strings.TrimPrefix(strings.TrimSpace(candidate), "W/")
		if candidate == "*" || candidate == etag {
			return true
		}
	}
	return false
}

func writeError(w http.ResponseWriter, status int, message string) {
	body, _ := json.Marshal(struct {
		Error string `json:"error"`
	}{message})
	w.Header().Del("ETag")
	w.Header().Del("Content-Encoding")
	w.Header().Set("Content-Type", contentTypeJSON)
	w.Header().Set("Cache-Control", cacheControlError)
	w.Header().Set("Content-Length", strconv.Itoa(len(body)))
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func withNoSniff(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}
