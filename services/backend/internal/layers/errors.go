package layers

import "errors"

var (
	ErrUnsupportedTileType        = errors.New("archive tiles are not Mapbox vector tiles")
	ErrUnsupportedTileCompression = errors.New("archive tile compression is not none or gzip")
	ErrInvalidMetadata            = errors.New("archive metadata is invalid")
	ErrInvalidArchiveName         = errors.New("archive name must be content-addressed: <name>-<16 lowercase hex>.pmtiles")
	ErrInvalidPublicURL           = errors.New("public URL must be an absolute http(s) URL without query or fragment")
)
