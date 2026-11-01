package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ivanov-gv/cg-map/services/backend/internal/pmtiles"
	"github.com/ivanov-gv/cg-map/services/backend/internal/pmtiles/pmtilestest"
	"github.com/ivanov-gv/cg-map/services/backend/internal/transport"
)

// writeArtifact creates a web artifact directory with index.html and one synthetic MVT archive in data/
func writeArtifact(t *testing.T) string {
	t.Helper()
	directory := t.TempDir()
	archive, err := pmtilestest.Build([]pmtilestest.Tile{{Z: 0, X: 0, Y: 0, Data: []byte("tile-0")}}, pmtilestest.Options{
		TileType:        pmtiles.TileTypeMVT,
		TileCompression: pmtiles.CompressionNone,
		Metadata:        `{"name":"test","vector_layers":[{"id":"roads"}]}`,
		MinZoom:         0,
		MaxZoom:         0,
	})
	if err != nil {
		t.Fatal(err)
	}
	err = os.MkdirAll(filepath.Join(directory, "data"), 0o700)
	if err != nil {
		t.Fatal(err)
	}
	err = os.WriteFile(filepath.Join(directory, "data", "montenegro-0123456789abcdef.pmtiles"), archive, 0o600)
	if err != nil {
		t.Fatal(err)
	}
	err = os.WriteFile(filepath.Join(directory, "index.html"), []byte("<!doctype html>"), 0o600)
	if err != nil {
		t.Fatal(err)
	}
	return directory
}

func TestAssetDirectoryAndRange(t *testing.T) {
	directory := t.TempDir()
	if err := os.WriteFile(filepath.Join(directory, "map.pmtiles"), []byte("PMTiles-test"), 0600); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/map.pmtiles", nil)
	request.Header.Set("Range", "bytes=0-6")
	response := httptest.NewRecorder()
	staticHandler(directory).ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "PMTiles" {
		t.Fatalf("range response: %d %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") != "application/vnd.pmtiles" {
		t.Fatal("incorrect archive MIME type")
	}
}

func TestRoutes(t *testing.T) {
	_app, err := newApp(writeArtifact(t), "", "", transport.Unavailable{})
	if err != nil {
		t.Fatal(err)
	}
	defer _app.Close()

	tests := []struct {
		name         string
		path         string
		status       int
		contentType  string
		cacheControl string
	}{
		{name: "static index", path: "/", status: http.StatusOK, contentType: "text/html; charset=utf-8", cacheControl: "no-cache"},
		{name: "tilejson", path: "/api/v1/layers", status: http.StatusOK, contentType: "application/json", cacheControl: "public, max-age=300"},
		{name: "tile", path: "/api/v1/layers/montenegro-0123456789abcdef/tiles/0/0/0.mvt", status: http.StatusOK, contentType: "application/vnd.mapbox-vector-tile", cacheControl: "public, max-age=31536000, immutable"},
		{name: "vehicles unavailable until a live source exists", path: "/api/v1/transport/vehicles", status: http.StatusServiceUnavailable, contentType: "application/json; charset=utf-8", cacheControl: "no-store"},
		{name: "unknown api path is JSON 404, not a static file", path: "/api/v1/unknown", status: http.StatusNotFound, contentType: "application/json", cacheControl: "no-store"},
		{name: "api root without slash is JSON 404", path: "/api", status: http.StatusNotFound, contentType: "application/json", cacheControl: "no-store"},
		{name: "web config selects the server APIs", path: "/config.json", status: http.StatusOK, contentType: "application/json", cacheControl: "no-store"},
		{name: "liveness", path: "/healthz", status: http.StatusOK, contentType: "text/plain; charset=utf-8", cacheControl: "no-store"},
		{name: "readiness", path: "/readyz", status: http.StatusOK, contentType: "text/plain; charset=utf-8", cacheControl: "no-store"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			_app.handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, test.path, nil))
			if response.Code != test.status {
				t.Fatalf("status = %d, want %d; body %q", response.Code, test.status, response.Body.String())
			}
			if got := response.Header().Get("Content-Type"); got != test.contentType {
				t.Fatalf("Content-Type = %q, want %q", got, test.contentType)
			}
			if got := response.Header().Get("Cache-Control"); test.cacheControl != "" && got != test.cacheControl {
				t.Fatalf("Cache-Control = %q, want %q", got, test.cacheControl)
			}
			if response.Header().Get("X-Content-Type-Options") != "nosniff" {
				t.Fatal("missing nosniff")
			}
		})
	}
}

func TestWebConfigOverridesArtifactFile(t *testing.T) {
	directory := writeArtifact(t)
	err := os.WriteFile(filepath.Join(directory, "config.json"), []byte(`{"api":"mock"}`), 0o600)
	if err != nil {
		t.Fatal(err)
	}
	_app, err := newApp(directory, "", "", transport.Unavailable{})
	if err != nil {
		t.Fatal(err)
	}
	defer _app.Close()

	response := httptest.NewRecorder()
	_app.handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/config.json", nil))
	var config struct {
		API string `json:"api"`
	}
	err = json.Unmarshal(response.Body.Bytes(), &config)
	if err != nil || config.API != "server" {
		t.Fatalf("config = %q, %v; want api=server", response.Body.String(), err)
	}
}

func TestTileJSONNamesArchiveLayers(t *testing.T) {
	_app, err := newApp(writeArtifact(t), "", "", transport.Unavailable{})
	if err != nil {
		t.Fatal(err)
	}
	defer _app.Close()

	response := httptest.NewRecorder()
	_app.handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://example.test/api/v1/layers", nil))
	var tileJSON struct {
		Tiles        []string `json:"tiles"`
		VectorLayers []struct {
			ID string `json:"id"`
		} `json:"vector_layers"`
	}
	err = json.Unmarshal(response.Body.Bytes(), &tileJSON)
	if err != nil {
		t.Fatalf("json.Unmarshal [body=%q]: %v", response.Body.String(), err)
	}
	if len(tileJSON.Tiles) != 1 || tileJSON.Tiles[0] != "http://example.test/api/v1/layers/montenegro-0123456789abcdef/tiles/{z}/{x}/{y}.mvt" {
		t.Fatalf("tiles = %v", tileJSON.Tiles)
	}
	if len(tileJSON.VectorLayers) != 1 || tileJSON.VectorLayers[0].ID != "roads" {
		t.Fatalf("vector_layers = %+v", tileJSON.VectorLayers)
	}
}

// TestGracefulShutdown runs the real serve loop: after cancellation /readyz must report 503 while the
// listener still accepts, an in-flight request must complete, and run must return only after it has.
func TestGracefulShutdown(t *testing.T) {
	var ready atomic.Bool
	ready.Store(true)
	release := make(chan struct{})
	slowStarted := make(chan struct{})
	mux := http.NewServeMux()
	mux.HandleFunc("/slow", func(w http.ResponseWriter, _ *http.Request) {
		close(slowStarted)
		<-release
		fmt.Fprint(w, "complete")
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		if !ready.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	base := "http://" + listener.Addr().String()
	ctx, cancel := context.WithCancel(context.Background())
	runErr := make(chan error, 1)
	go func() {
		runErr <- run(ctx, &http.Server{Handler: mux}, listener, &ready, 300*time.Millisecond, 5*time.Second)
	}()

	// hold a request in flight
	slowBody := make(chan string, 1)
	go func() {
		response, err := http.Get(base + "/slow")
		if err != nil {
			slowBody <- "error: " + err.Error()
			return
		}
		defer response.Body.Close()
		body, _ := io.ReadAll(response.Body)
		slowBody <- string(body)
	}()
	<-slowStarted

	// shutdown starts: readiness drops while the listener still accepts
	cancel()
	deadline := time.Now().Add(250 * time.Millisecond)
	sawNotReady := false
	for time.Now().Before(deadline) && !sawNotReady {
		response, err := http.Get(base + "/readyz")
		if err == nil {
			sawNotReady = response.StatusCode == http.StatusServiceUnavailable
			response.Body.Close()
		}
	}
	if !sawNotReady {
		t.Fatal("/readyz never reported 503 during the drain delay")
	}

	// run must wait for the in-flight request
	select {
	case err := <-runErr:
		t.Fatalf("run returned before the in-flight request finished: %v", err)
	case <-time.After(500 * time.Millisecond):
	}
	close(release)
	if body := <-slowBody; body != "complete" {
		t.Fatalf("in-flight request body = %q, want %q", body, "complete")
	}
	if err := <-runErr; err != nil {
		t.Fatalf("run: %v", err)
	}
}

func TestFindArchive(t *testing.T) {
	tests := []struct {
		name    string
		files   []string
		wantErr error
	}{
		{name: "single archive", files: []string{"a.pmtiles", "places.geojson"}},
		{name: "no archive", files: []string{"places.geojson"}, wantErr: errNoArchive},
		{name: "several archives are ambiguous", files: []string{"a.pmtiles", "b.pmtiles"}, wantErr: errMultipleArchives},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			for _, file := range test.files {
				err := os.WriteFile(filepath.Join(dir, file), nil, 0o600)
				if err != nil {
					t.Fatal(err)
				}
			}
			found, err := findArchive(dir)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("err = %v, want %v", err, test.wantErr)
			}
			if test.wantErr == nil && filepath.Base(found) != "a.pmtiles" {
				t.Fatalf("found = %q", found)
			}
		})
	}
}

func TestPublicURLOverridesHost(t *testing.T) {
	_app, err := newApp(writeArtifact(t), "", "https://maps.example.com/cg", transport.Unavailable{})
	if err != nil {
		t.Fatal(err)
	}
	defer _app.Close()

	response := httptest.NewRecorder()
	_app.handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://attacker.test/api/v1/layers", nil))
	if !strings.Contains(response.Body.String(), `"https://maps.example.com/cg/api/v1/layers/montenegro-0123456789abcdef/tiles/{z}/{x}/{y}.mvt"`) {
		t.Fatalf("TileJSON does not use the public URL: %s", response.Body.String())
	}
}

func TestNewAppFailsWithoutArchive(t *testing.T) {
	_, err := newApp(t.TempDir(), "", "", transport.Unavailable{})
	if !errors.Is(err, errNoArchive) {
		t.Fatalf("err = %v, want errNoArchive", err)
	}
}
