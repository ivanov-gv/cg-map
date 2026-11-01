package layers

import "regexp"

// releaseArchiveName is the content-addressed release naming of data/artifacts/release.json,
// e.g. "montenegro-d4f4f7de5f0ccb10.pmtiles"
var releaseArchiveName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]*-[0-9a-f]{16}\.pmtiles$`)

const (
	tileJSONPath = "/api/v1/layers"
	// tilePattern puts the release token (archive name without extension) in every tile URL
	tilePattern      = tileJSONPath + "/{release}/tiles/{z}/{x}/{file}"
	tileExtension    = ".mvt"
	archiveExtension = ".pmtiles"

	tileJSONVersion = "3.0.0"

	contentTypeJSON = "application/json"
	contentTypeMVT  = "application/vnd.mapbox-vector-tile"

	// tile URLs embed the content-addressed release token, so tiles never change under a URL;
	// matches the .pmtiles rule in platform/hosting/Caddyfile
	cacheControlTile = "public, max-age=31536000, immutable"
	// TileJSON names the current release and must follow a new archive quickly
	cacheControlTileJSON = "public, max-age=300"
	cacheControlError    = "no-store"

	// maxTileDecompressedLength bounds a gunzipped tile streamed to clients without gzip support
	maxTileDecompressedLength = 8 << 20
)
