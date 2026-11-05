// Package layers serves map layers from a PMTiles archive as TileJSON and vector tiles.
package layers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/ivanov-gv/cg-map/services/backend/internal/client/pmtiles"
)

// NewHandler serves GET /api/v1/layers (TileJSON for the current release) and
// GET /api/v1/layers/{release}/tiles/{z}/{x}/{y}.mvt from an MVT archive.
// archiveName must be content-addressed (e.g. "montenegro-d4f4f7de5f0ccb10.pmtiles"): its name without
// the .pmtiles extension is the release token in tile URLs, which lets tiles be cached as immutable.
func NewHandler(archive *pmtiles.Archive, archiveName string, optionSetters ...Option) (http.Handler, error) {
	// apply options
	var _options options
	for _, setOption := range optionSetters {
		setOption(&_options)
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
	_metadata, err := readMetadata(archive)
	if err != nil {
		return nil, fmt.Errorf("readMetadata [archive='%s']: %w", archiveName, err)
	}

	layersHandler := &handler{
		archive:      archive,
		release:      release,
		publicURL:    publicURL,
		isGzipStored: header.TileCompression == pmtiles.CompressionGzip,
		minZoom:      header.MinZoom,
		maxZoom:      header.MaxZoom,
		tileJSON:     newTileJSON(header, _metadata, release),
	}

	routes := http.NewServeMux()
	routes.HandleFunc(Path, layersHandler.serveTileJSON)
	routes.HandleFunc(tilePattern, layersHandler.serveTile)
	routes.HandleFunc(Path+"/", func(w http.ResponseWriter, _ *http.Request) {
		writeError(w, http.StatusNotFound, "not found")
	})
	return withNoSniff(routes), nil
}

// readMetadata decodes the archive's JSON metadata.
func readMetadata(archive *pmtiles.Archive) (metadata, error) {
	rawMetadata, err := archive.Metadata()
	if err != nil {
		return metadata{}, fmt.Errorf("archive.Metadata: %w", err)
	}
	var _metadata metadata
	err = json.Unmarshal(rawMetadata, &_metadata)
	if err != nil {
		return metadata{}, fmt.Errorf("json.Unmarshal: %w: %w", ErrInvalidMetadata, err)
	}
	return _metadata, nil
}

// handler serves one archive as one release. Everything but the archive reads is fixed at construction.
type handler struct {
	archive      *pmtiles.Archive
	release      string
	publicURL    string // empty: derive scheme and host from the request
	isGzipStored bool
	minZoom      uint8
	maxZoom      uint8
	tileJSON     tileJSON
}

// metadata is the subset of PMTiles JSON metadata exposed through TileJSON
type metadata struct {
	Name         string        `json:"name"`
	Description  string        `json:"description"`
	Attribution  string        `json:"attribution"`
	VectorLayers []vectorLayer `json:"vector_layers"`
}

// vectorLayer describes one layer in the archive's tiles, in both metadata and TileJSON.
type vectorLayer struct {
	ID          string          `json:"id"`
	Description string          `json:"description,omitempty"`
	MinZoom     *int            `json:"minzoom,omitempty"`
	MaxZoom     *int            `json:"maxzoom,omitempty"`
	Fields      json.RawMessage `json:"fields"`
}
