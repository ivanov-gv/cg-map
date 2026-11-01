package main

import (
	"errors"
	"fmt"
	"net/http"
	"path/filepath"
	"strings"
	"sync/atomic"

	"github.com/ivanov-gv/cg-map/services/backend/internal/layers"
	"github.com/ivanov-gv/cg-map/services/backend/internal/pmtiles"
	"github.com/ivanov-gv/cg-map/services/backend/internal/transport"
)

var (
	errNoArchive        = errors.New("no *.pmtiles archive found")
	errMultipleArchives = errors.New("several *.pmtiles archives found; pass -archive")
)

// app holds the server's routes and the resources they share
type app struct {
	handler     http.Handler
	archive     *pmtiles.Archive
	archiveName string
	transport   *transport.Handler
	ready       atomic.Bool
}

// newApp opens the layers archive (archivePath, or the single *.pmtiles in <directory>/data)
// and routes the APIs, health checks, web config and static files. publicURL, if set, is the base of
// tile URLs in TileJSON. vehicles supplies the transport API.
func newApp(directory, archivePath, publicURL string, vehicles transport.Source) (*app, error) {
	// locate the archive the web artifact ships with, unless one is given explicitly
	if archivePath == "" {
		found, err := findArchive(filepath.Join(directory, "data"))
		if err != nil {
			return nil, fmt.Errorf("findArchive [dir='%s']: %w", directory, err)
		}
		archivePath = found
	}

	archive, err := pmtiles.Open(archivePath)
	if err != nil {
		return nil, fmt.Errorf("pmtiles.Open [path='%s']: %w", archivePath, err)
	}
	archiveName := filepath.Base(archivePath)
	layersHandler, err := layers.NewHandler(archive, archiveName, layers.WithPublicURL(publicURL))
	if err != nil {
		archive.Close()
		return nil, fmt.Errorf("layers.NewHandler [archive='%s']: %w", archiveName, err)
	}

	transportHandler := transport.NewHandler(vehicles)

	_app := &app{archive: archive, archiveName: archiveName, transport: transportHandler}
	_app.ready.Store(true)

	mux := http.NewServeMux()
	mux.Handle("/api/v1/layers", layersHandler)
	mux.Handle("/api/v1/layers/", layersHandler)
	mux.Handle(transport.VehiclesPath, transportHandler)
	mux.HandleFunc("/api", apiNotFound)
	mux.HandleFunc("/api/", apiNotFound)
	mux.HandleFunc(webConfigPath, webConfig)
	mux.HandleFunc("/healthz", healthz)
	mux.HandleFunc("/readyz", _app.readyz)
	mux.Handle("/", staticHandler(directory))
	_app.handler = mux
	return _app, nil
}

// Close releases the archive
func (a *app) Close() error {
	return a.archive.Close()
}

// findArchive returns the only *.pmtiles file in dir
func findArchive(dir string) (string, error) {
	matches, err := filepath.Glob(filepath.Join(dir, "*.pmtiles"))
	if err != nil {
		return "", fmt.Errorf("filepath.Glob [dir='%s']: %w", dir, err)
	}
	if len(matches) == 0 {
		return "", errNoArchive
	}
	if len(matches) > 1 {
		return "", fmt.Errorf("%w: %s", errMultipleArchives, strings.Join(matches, ", "))
	}
	return matches[0], nil
}

// webConfigPath overrides the artifact's static config.json, which tells static hosts (GitHub Pages,
// make dev) to read the archive and the hosted relay directly. Here the app uses this server's APIs.
const webConfigPath = "/config.json"

// webConfig tells the web app that this host serves the layers and transport APIs
func webConfig(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	fmt.Fprintln(w, `{"api":"server"}`)
}

// healthz reports liveness: the process is serving requests
func healthz(w http.ResponseWriter, _ *http.Request) {
	writeStatus(w, http.StatusOK, "ok")
}

// readyz reports readiness: false once shutdown has started, so load balancers stop routing here
func (a *app) readyz(w http.ResponseWriter, _ *http.Request) {
	if !a.ready.Load() {
		writeStatus(w, http.StatusServiceUnavailable, "shutting down")
		return
	}
	writeStatus(w, http.StatusOK, "ready")
}

func writeStatus(w http.ResponseWriter, status int, body string) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(status)
	fmt.Fprintln(w, body)
}

// apiNotFound keeps unknown API paths from falling through to the static file server
func apiNotFound(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusNotFound)
	fmt.Fprintln(w, `{"error":"not found"}`)
}

// staticHandler serves the built web artifact with the static hosting headers
func staticHandler(directory string) http.Handler {
	files := http.FileServer(http.Dir(directory))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasSuffix(r.URL.Path, ".pmtiles") {
			w.Header().Set("Content-Type", "application/vnd.pmtiles")
			w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
		}
		if strings.HasSuffix(r.URL.Path, ".js") {
			w.Header().Set("Content-Type", "text/javascript")
		}
		if strings.HasSuffix(r.URL.Path, ".geojson") {
			w.Header().Set("Content-Type", "application/geo+json")
		}
		files.ServeHTTP(w, r)
	})
}
