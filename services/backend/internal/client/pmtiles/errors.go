package pmtiles

import "errors"

// Errors reported for a malformed or unsupported archive.
var (
	ErrInvalidMagic           = errors.New("not a PMTiles archive")
	ErrUnsupportedVersion     = errors.New("unsupported PMTiles spec version")
	ErrUnsupportedCompression = errors.New("unsupported compression")
	ErrInvalidTileCoordinates = errors.New("tile coordinates out of range")
	ErrInvalidDirectory       = errors.New("invalid directory")
	ErrMaxDirectoryDepth      = errors.New("maximum directory depth exceeded")
	ErrSectionOutOfBounds     = errors.New("section out of archive bounds")
	ErrSectionTooLarge        = errors.New("section exceeds size limit")
	ErrInvalidMetadata        = errors.New("metadata is not valid JSON")
)
