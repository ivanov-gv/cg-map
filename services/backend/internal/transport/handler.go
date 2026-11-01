package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"time"
)

// Handler serves the read-only vehicle feed at VehiclesPath with relay.mjs headers and status codes.
type Handler struct {
	http.Handler
	feed         *feed
	pollInterval time.Duration
}

// NewHandler returns the vehicle feed handler. With Unavailable{} every GET answers 503.
func NewHandler(source Source) *Handler {
	vehicleFeed := newFeed(source, time.Now)
	return &Handler{Handler: newHandler(vehicleFeed), feed: vehicleFeed, pollInterval: pollInterval}
}

// Poll keeps the feed warm until ctx is done: it refreshes whenever the 13 s cache expires, so
// movement directions are known before a viewer arrives. The upstream sees at most one request per
// cache period, the rate of a single ePodgorica map viewer. Viewer requests share the same refreshes.
func (h *Handler) Poll(ctx context.Context) {
	ticker := time.NewTicker(h.pollInterval)
	defer ticker.Stop()
	for {
		// failures are logged by the feed and reported to viewers as stale/503
		_, _ = h.feed.Current(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func newHandler(vehicleFeed *feed) http.Handler {
	mux := http.NewServeMux()
	// no method in the pattern: HEAD and others must reach the 405 branch, as in relay.mjs
	mux.Handle(VehiclesPath, &vehiclesHandler{feed: vehicleFeed})
	return mux
}

type vehiclesHandler struct {
	feed *feed
}

func (h *vehiclesHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	header := w.Header()
	header.Set("Access-Control-Allow-Origin", "*")
	header.Set("Access-Control-Allow-Methods", allowedMethods)
	header.Set("Content-Type", jsonContentType)
	header.Set("Cache-Control", publicCacheControl)
	header.Set("X-Content-Type-Options", "nosniff")

	// CORS preflight and read-only enforcement
	switch r.Method {
	case http.MethodOptions:
		w.WriteHeader(http.StatusNoContent)
		return
	case http.MethodGet:
	default:
		header.Set("Allow", allowedMethods)
		writeJSON(w, http.StatusMethodNotAllowed, struct {
			Error string `json:"error"`
		}{Error: methodNotAllowed})
		return
	}

	collection, err := h.feed.Current(r.Context())
	// expired or never fetched: explicit unavailable body
	if err != nil {
		header.Set("Cache-Control", noStoreControl)
		writeJSON(w, http.StatusServiceUnavailable, collection)
		return
	}
	// stale snapshots must not be cached downstream
	if collection.Stale {
		header.Set("Cache-Control", noStoreControl)
	}
	writeJSON(w, http.StatusOK, collection)
}

// writeJSON writes value like JS Response.json: no HTML escaping, no trailing newline.
func writeJSON(w http.ResponseWriter, status int, value any) {
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(value); err != nil {
		// only fixed, finite-valued types are encoded here
		w.Header().Set("Cache-Control", noStoreControl)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"Internal server error"}`))
		return
	}
	w.WriteHeader(status)
	_, _ = w.Write(bytes.TrimSuffix(body.Bytes(), []byte("\n")))
}
