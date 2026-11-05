package layers

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/ivanov-gv/cg-map/services/backend/internal/client/pmtiles"
)

// tileJSON is the TileJSON 3.0.0 document, without Tiles until a request supplies the base URL.
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

// newTileJSON combines the archive header and metadata; an unnamed archive takes the release as its name.
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
		Bounds:       [4]float64{header.MinLongitude, header.MinLatitude, header.MaxLongitude, header.MaxLatitude},
		Center:       [3]float64{header.CenterLongitude, header.CenterLatitude, float64(header.CenterZoom)},
		VectorLayers: vectorLayers,
	}
}

// serveTileJSON writes TileJSON whose tile URL template points at the current release
func (h *handler) serveTileJSON(w http.ResponseWriter, r *http.Request) {
	if !allowRead(w, r) {
		return
	}

	// absolute tile URL from the configured public URL, or from the request
	baseURL := h.publicURL
	if baseURL == "" {
		baseURL = requestScheme(r) + "://" + r.Host
		// the tile URL depends on the forwarded scheme
		w.Header().Set("Vary", "X-Forwarded-Proto")
	}
	document := h.tileJSON
	document.Tiles = []string{baseURL + Path + "/" + h.release + "/tiles/{z}/{x}/{y}" + tileExtension}
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
