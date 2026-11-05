package pmtiles

const (
	// HeaderBytes is the fixed size of a PMTiles v3 header in bytes
	HeaderBytes = 127
	// MaxZoom is the deepest zoom whose tile coordinates fit uint32 and whose tile IDs fit uint64
	MaxZoom = 31

	magic         = "PMTiles"
	versionOffset = len(magic)
	specVersion   = 3
	// storedUnitsPerDegree converts header positions, stored in units of 1e-7 degrees
	storedUnitsPerDegree = 1e7

	// maxDirectoryDepth bounds root + leaf directory reads per lookup, like the reference implementation
	maxDirectoryDepth = 4
	// leafCacheMaxEntries bounds the total number of decoded leaf entries kept in memory (32 bytes each)
	leafCacheMaxEntries = 1 << 18
	// maxSectionBytes bounds a single compressed directory or metadata read
	maxSectionBytes = 16 << 20
	// maxDirectoryBytes bounds a decompressed directory; real leaf sections are ~100 KB in total
	maxDirectoryBytes = 2 << 20
	// maxMetadataBytes bounds decompressed JSON metadata
	maxMetadataBytes = 16 << 20
	// maxTileBytes bounds a single stored tile read
	maxTileBytes = 16 << 20
	// minEntryBytes is the smallest encoding of one directory entry: four 1-byte uvarints
	minEntryBytes = 4
)

// Compression is the PMTiles compression enum used for internal sections and tiles
type Compression uint8

// Compression values, as stored in the archive header.
const (
	CompressionUnknown Compression = 0
	CompressionNone    Compression = 1
	CompressionGzip    Compression = 2
	CompressionBrotli  Compression = 3
	CompressionZstd    Compression = 4
)

func (c Compression) String() string {
	switch c {
	case CompressionUnknown:
		return "unknown"
	case CompressionNone:
		return "none"
	case CompressionGzip:
		return "gzip"
	case CompressionBrotli:
		return "brotli"
	case CompressionZstd:
		return "zstd"
	}
	return "invalid"
}

// TileType is the PMTiles tile format enum
type TileType uint8

// TileType values, as stored in the archive header.
const (
	TileTypeUnknown TileType = 0
	TileTypeMVT     TileType = 1
	TileTypePNG     TileType = 2
	TileTypeJPEG    TileType = 3
	TileTypeWebP    TileType = 4
	TileTypeAVIF    TileType = 5
)

func (t TileType) String() string {
	switch t {
	case TileTypeUnknown:
		return "unknown"
	case TileTypeMVT:
		return "mvt"
	case TileTypePNG:
		return "png"
	case TileTypeJPEG:
		return "jpeg"
	case TileTypeWebP:
		return "webp"
	case TileTypeAVIF:
		return "avif"
	}
	return "invalid"
}
