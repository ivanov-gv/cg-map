package transport

import (
	"bytes"
	"encoding/json"
	"net/http"
)

// NewVehiclesHandler serves the read-only GeoJSON feed at VehiclesPath with relay.mjs headers and
// status codes. Other paths answer 404.
func NewVehiclesHandler(feed VehicleFeed) http.Handler {
	routes := http.NewServeMux()
	// no method in the pattern: HEAD and others must reach the 405 branch, as in relay.mjs
	routes.Handle(VehiclesPath, &vehiclesHandler{feed: feed})
	return routes
}

// vehiclesHandler answers one vehicle feed request.
type vehiclesHandler struct {
	feed VehicleFeed
}

// ServeHTTP answers like relay.mjs: CORS on every response, GET and OPTIONS only, 503 without a
// usable snapshot, and no downstream caching of stale or unavailable bodies.
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
		}{Error: methodNotAllowedMessage})
		return
	}

	snapshot, err := h.feed.Current(r.Context())
	// still observing, expired or never fetched: explicit unavailable body
	if err != nil {
		header.Set("Cache-Control", noStoreCacheControl)
		writeJSON(w, http.StatusServiceUnavailable, unavailableCollection())
		return
	}
	// stale snapshots must not be cached downstream
	if snapshot.Stale {
		header.Set("Cache-Control", noStoreCacheControl)
	}
	writeJSON(w, http.StatusOK, toFeatureCollection(snapshot))
}

// writeJSON writes value like JS Response.json: no HTML escaping, no trailing newline.
func writeJSON(w http.ResponseWriter, status int, value any) {
	var body bytes.Buffer
	encoder := json.NewEncoder(&body)
	encoder.SetEscapeHTML(false)
	err := encoder.Encode(value)
	if err != nil {
		// only fixed, finite-valued types are encoded here
		w.Header().Set("Cache-Control", noStoreCacheControl)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"Internal server error"}`))
		return
	}
	w.WriteHeader(status)
	_, _ = w.Write(bytes.TrimSuffix(body.Bytes(), []byte("\n")))
}
