// Package web serves the built web artifact and the small plain endpoints around it: the web
// config, health checks and the JSON 404 for unknown API paths.
package web

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/ivanov-gv/cg-map/services/backend/internal/server/layers"
)

// ConfigPath overrides the artifact's static config.json, which tells static hosts (GitHub Pages,
// make dev-mock) to read the archive and the hosted relay directly. Here the app uses this server's APIs.
const ConfigPath = "/config.json"

// setUncachedHeaders marks a generated response that clients and proxies must not store.
func setUncachedHeaders(w http.ResponseWriter, contentType string) {
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
}

// ServeConfig tells the web app that this host serves the layers and transport APIs.
func ServeConfig(w http.ResponseWriter, _ *http.Request) {
	setUncachedHeaders(w, "application/json")
	_, _ = fmt.Fprintln(w, `{"api":"server"}`)
}

// ServeLiveness reports liveness: the process is serving requests.
func ServeLiveness(w http.ResponseWriter, _ *http.Request) {
	writeStatus(w, http.StatusOK, "ok")
}

// NewReadinessHandler gates rollout traffic until transport observation finishes, and drops during shutdown.
func NewReadinessHandler(isShuttingDown, isTransportReady func() bool) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		if isShuttingDown() {
			writeStatus(w, http.StatusServiceUnavailable, "shutting down")
			return
		}
		if !isTransportReady() {
			writeStatus(w, http.StatusServiceUnavailable, "transport warming up")
			return
		}
		writeStatus(w, http.StatusOK, "ready")
	}
}

// writeStatus writes a one-line plain text health response.
func writeStatus(w http.ResponseWriter, status int, body string) {
	setUncachedHeaders(w, "text/plain; charset=utf-8")
	w.WriteHeader(status)
	_, _ = fmt.Fprintln(w, body)
}

// ServeAPINotFound keeps unknown API paths from falling through to the static file server.
func ServeAPINotFound(w http.ResponseWriter, _ *http.Request) {
	setUncachedHeaders(w, "application/json")
	w.WriteHeader(http.StatusNotFound)
	_, _ = fmt.Fprintln(w, `{"error":"not found"}`)
}

// NewStaticHandler serves the built web artifact with the static hosting headers.
func NewStaticHandler(directory string) http.Handler {
	fileServer := http.FileServer(http.Dir(directory))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-cache")
		if strings.HasSuffix(r.URL.Path, ".pmtiles") {
			w.Header().Set("Content-Type", "application/vnd.pmtiles")
			w.Header().Set("Cache-Control", layers.CacheControlImmutable)
		}
		if strings.HasSuffix(r.URL.Path, ".js") {
			w.Header().Set("Content-Type", "text/javascript")
		}
		if strings.HasSuffix(r.URL.Path, ".geojson") {
			w.Header().Set("Content-Type", "application/geo+json")
		}
		fileServer.ServeHTTP(w, r)
	})
}
