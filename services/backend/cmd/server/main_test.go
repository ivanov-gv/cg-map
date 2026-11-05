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
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	transportv1 "github.com/ivanov-gv/cg-map/services/backend/gen/cgmap/transport/v1"
	"github.com/ivanov-gv/cg-map/services/backend/gen/cgmap/transport/v1/transportv1connect"

	"github.com/ivanov-gv/cg-map/services/backend/internal/client/pmtiles"
	"github.com/ivanov-gv/cg-map/services/backend/internal/client/pmtiles/pmtilestest"
	"github.com/ivanov-gv/cg-map/services/backend/internal/server/transport"
	"github.com/ivanov-gv/cg-map/services/backend/internal/server/web"
	"github.com/ivanov-gv/cg-map/services/backend/internal/service/vehicles"
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
	web.NewStaticHandler(directory).ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "PMTiles" {
		t.Fatalf("range response: %d %q", response.Code, response.Body.String())
	}
	if response.Header().Get("Content-Type") != "application/vnd.pmtiles" {
		t.Fatal("incorrect archive MIME type")
	}
	if got := response.Header().Get("Cache-Control"); got != "public, max-age=31536000, immutable" {
		t.Fatalf("archive Cache-Control = %q", got)
	}
}

func TestRoutes(t *testing.T) {
	_app, err := newApp(writeArtifact(t), "", "", vehicles.Unavailable{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = _app.Close() }()

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

// startupSource holds the first upstream response until explicitly released. It ignores the
// feed timeout, so a slow test cannot start another source call before cleanup releases this one.
type startupSource struct {
	entered chan struct{}
	release chan struct{}
	exited  chan struct{}
	once    sync.Once
}

func (s *startupSource) Vehicles(context.Context) ([]vehicles.UpstreamVehicle, error) {
	s.once.Do(func() { close(s.entered) })
	<-s.release
	close(s.exited)
	return nil, context.Canceled
}

func TestServingDuringTransportObservation(t *testing.T) { //nolint:funlen // linear scenario; splitting it would hide the order of events
	source := &startupSource{entered: make(chan struct{}), release: make(chan struct{}), exited: make(chan struct{})}
	_app, err := newApp(writeArtifact(t), "", "", source)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = _app.Close() }()
	ctx, cancel := context.WithCancel(context.Background())
	observerStopped := _app.observer.Start(ctx)
	t.Cleanup(func() {
		cancel()
		select {
		case <-observerStopped:
		case <-time.After(5 * time.Second):
			t.Error("transport observer did not stop")
		}
		close(source.release)
		select {
		case <-source.exited:
		case <-time.After(5 * time.Second):
			t.Error("upstream fixture did not exit")
		}
	})
	select {
	case <-source.entered:
	case <-time.After(5 * time.Second):
		t.Fatal("transport observation did not start")
	}
	server := httptest.NewServer(_app.handler)
	defer server.Close()
	client := server.Client()
	client.Timeout = time.Second
	for _, test := range []struct {
		path   string
		status int
	}{{"/", 200}, {"/config.json", 200}, {"/api/v1/layers", 200}, {"/healthz", 200}, {"/readyz", 503}, {transport.VehiclesPath, 503}} {
		t.Run(test.path, func(t *testing.T) {
			response, err := client.Get(server.URL + test.path)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = response.Body.Close() }()
			if response.StatusCode != test.status {
				t.Fatalf("status = %d, want %d", response.StatusCode, test.status)
			}
			if test.status == 503 && response.Header.Get("Cache-Control") != "no-store" {
				t.Fatal("startup unavailability must not be cached")
			}
		})
	}
	rpcClient := transportv1connect.NewTransportServiceClient(connect.NewClient(connecthttp.NewTransport(client, server.URL)))
	rpcCtx, callInfo := connect.NewClientContext(context.Background())
	if _, err := rpcClient.ListVehicles(rpcCtx, &transportv1.ListVehiclesRequest{}); connect.CodeOf(err) != connect.CodeUnavailable {
		t.Fatalf("RPC error during observation = %v, want unavailable", err)
	}
	if callInfo.ResponseHeader().Get("Cache-Control") != "no-store" {
		t.Fatal("RPC during observation must not be cached")
	}
	// Shutdown takes precedence over the startup state for readiness diagnostics.
	_app.isShuttingDown.Store(true)
	response := httptest.NewRecorder()
	_app.handler.ServeHTTP(response, httptest.NewRequest("GET", "/readyz", nil))
	if response.Code != 503 || response.Body.String() != "shutting down\n" {
		t.Fatalf("shutdown readiness = %d %q", response.Code, response.Body.String())
	}
}

func TestWebConfigOverridesArtifactFile(t *testing.T) {
	directory := writeArtifact(t)
	err := os.WriteFile(filepath.Join(directory, "config.json"), []byte(`{"api":"mock"}`), 0o600)
	if err != nil {
		t.Fatal(err)
	}
	_app, err := newApp(directory, "", "", vehicles.Unavailable{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = _app.Close() }()

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
	_app, err := newApp(writeArtifact(t), "", "", vehicles.Unavailable{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = _app.Close() }()

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
// listener still accepts, an in-flight request must complete, and serveUntilShutdown must return only after it has.
func TestGracefulShutdown(t *testing.T) { //nolint:funlen // linear scenario; splitting it would hide the order of events
	var isShuttingDown atomic.Bool
	release := make(chan struct{})
	slowStarted := make(chan struct{})
	routes := http.NewServeMux()
	routes.HandleFunc("/slow", func(w http.ResponseWriter, _ *http.Request) {
		close(slowStarted)
		<-release
		_, _ = fmt.Fprint(w, "complete")
	})
	routes.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		if isShuttingDown.Load() {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	})

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	baseURL := "http://" + listener.Addr().String()
	ctx, cancel := context.WithCancel(context.Background())
	serveResult := make(chan error, 1)
	go func() {
		serveResult <- serveUntilShutdown(ctx, &http.Server{Handler: routes}, listener, &isShuttingDown, 300*time.Millisecond, 5*time.Second)
	}()

	// hold a request in flight
	slowBody := make(chan string, 1)
	go func() {
		response, err := http.Get(baseURL + "/slow")
		if err != nil {
			slowBody <- "error: " + err.Error()
			return
		}
		defer func() { _ = response.Body.Close() }()
		body, _ := io.ReadAll(response.Body)
		slowBody <- string(body)
	}()
	<-slowStarted

	// shutdown starts: readiness drops while the listener still accepts
	cancel()
	deadline := time.Now().Add(250 * time.Millisecond)
	sawNotReady := false
	for time.Now().Before(deadline) && !sawNotReady {
		response, err := http.Get(baseURL + "/readyz")
		if err == nil {
			sawNotReady = response.StatusCode == http.StatusServiceUnavailable
			_ = response.Body.Close()
		}
	}
	if !sawNotReady {
		t.Fatal("/readyz never reported 503 during the drain delay")
	}

	// serveUntilShutdown must wait for the in-flight request
	select {
	case err := <-serveResult:
		t.Fatalf("serveUntilShutdown returned before the in-flight request finished: %v", err)
	case <-time.After(500 * time.Millisecond):
	}
	close(release)
	if body := <-slowBody; body != "complete" {
		t.Fatalf("in-flight request body = %q, want %q", body, "complete")
	}
	if err := <-serveResult; err != nil {
		t.Fatalf("serveUntilShutdown: %v", err)
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
			directory := t.TempDir()
			for _, file := range test.files {
				err := os.WriteFile(filepath.Join(directory, file), nil, 0o600)
				if err != nil {
					t.Fatal(err)
				}
			}
			found, err := findArchive(directory)
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
	_app, err := newApp(writeArtifact(t), "", "https://maps.example.com/cg", vehicles.Unavailable{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = _app.Close() }()

	response := httptest.NewRecorder()
	_app.handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://attacker.test/api/v1/layers", nil))
	if !strings.Contains(response.Body.String(), `"https://maps.example.com/cg/api/v1/layers/montenegro-0123456789abcdef/tiles/{z}/{x}/{y}.mvt"`) {
		t.Fatalf("TileJSON does not use the public URL: %s", response.Body.String())
	}
}

func TestNewAppFailsWithoutArchive(t *testing.T) {
	_, err := newApp(t.TempDir(), "", "", vehicles.Unavailable{})
	if !errors.Is(err, errNoArchive) {
		t.Fatalf("err = %v, want errNoArchive", err)
	}
}

// rpcSource supplies one normalized position to both API formats.
type rpcSource struct{ calls atomic.Int32 }

func (s *rpcSource) Vehicles(context.Context) ([]vehicles.UpstreamVehicle, error) {
	s.calls.Add(1)
	return []vehicles.UpstreamVehicle{{Route: "6A", Longitude: 19.26, Latitude: 42.44}}, nil
}

func TestTransportRPCSharesGeoJSONSnapshot(t *testing.T) {
	source := &rpcSource{}
	_app, err := newApp(writeArtifact(t), "", "", source)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = _app.Close() }()
	server := httptest.NewServer(_app.handler)
	defer server.Close()
	client := transportv1connect.NewTransportServiceClient(connect.NewClient(connecthttp.NewTransport(server.Client(), server.URL)))
	rpcResponse, err := client.ListVehicles(context.Background(), &transportv1.ListVehiclesRequest{})
	if err != nil {
		t.Fatal(err)
	}
	response, err := server.Client().Get(server.URL + transport.VehiclesPath)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = response.Body.Close() }()
	var geoJSON transport.FeatureCollection
	if err := json.NewDecoder(response.Body).Decode(&geoJSON); err != nil {
		t.Fatal(err)
	}
	if len(rpcResponse.Vehicles) != 1 || len(geoJSON.Features) != 1 {
		t.Fatalf("RPC=%v, GeoJSON=%v", rpcResponse, geoJSON)
	}
	rpcVehicle := rpcResponse.Vehicles[0]
	geoJSONVehicle := geoJSON.Features[0]
	fetchedAt, err := time.Parse(time.RFC3339Nano, *geoJSON.FetchedAt)
	if err != nil {
		t.Fatal(err)
	}
	isSameVehicle := rpcVehicle.Route == geoJSONVehicle.Properties.Route &&
		rpcVehicle.Longitude == geoJSONVehicle.Geometry.Coordinates[0] &&
		rpcVehicle.Latitude == geoJSONVehicle.Geometry.Coordinates[1] &&
		rpcVehicle.Direction == nil
	isSameSnapshot := rpcResponse.SourceUrl == geoJSON.Source &&
		rpcResponse.Stale == geoJSON.Stale &&
		rpcResponse.FetchedAt.AsTime().Equal(fetchedAt)
	if !isSameVehicle || !isSameSnapshot {
		t.Fatalf("different snapshots: RPC=%v, GeoJSON=%v", rpcResponse, geoJSON)
	}
	if source.calls.Load() != 1 {
		t.Fatalf("source called %d times, want shared cache", source.calls.Load())
	}
}
