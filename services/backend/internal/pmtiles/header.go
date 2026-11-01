package pmtiles

import (
	"encoding/binary"
	"fmt"
)

// Header is the decoded fixed-size PMTiles v3 header
type Header struct {
	SpecVersion uint8

	RootDirectoryOffset   uint64
	RootDirectoryLength   uint64
	MetadataOffset        uint64
	MetadataLength        uint64
	LeafDirectoriesOffset uint64
	LeafDirectoriesLength uint64
	TileDataOffset        uint64
	TileDataLength        uint64

	AddressedTiles uint64
	TileEntries    uint64
	TileContents   uint64

	Clustered           bool
	InternalCompression Compression
	TileCompression     Compression
	TileType            TileType

	MinZoom uint8
	MaxZoom uint8
	// bounds in degrees
	MinLon float64
	MinLat float64
	MaxLon float64
	MaxLat float64

	CenterZoom uint8
	CenterLon  float64
	CenterLat  float64
}

// decodeHeader parses and validates the first HeaderLength bytes of an archive
func decodeHeader(data []byte) (Header, error) {
	if len(data) < HeaderLength || string(data[:len(magic)]) != magic {
		return Header{}, ErrInvalidMagic
	}
	if data[7] != specVersion {
		return Header{}, fmt.Errorf("decodeHeader [version=%d]: %w", data[7], ErrUnsupportedVersion)
	}

	u64 := func(offset int) uint64 { return binary.LittleEndian.Uint64(data[offset:]) }
	degrees := func(offset int) float64 { return float64(int32(binary.LittleEndian.Uint32(data[offset:]))) / 1e7 }

	return Header{
		SpecVersion:           data[7],
		RootDirectoryOffset:   u64(8),
		RootDirectoryLength:   u64(16),
		MetadataOffset:        u64(24),
		MetadataLength:        u64(32),
		LeafDirectoriesOffset: u64(40),
		LeafDirectoriesLength: u64(48),
		TileDataOffset:        u64(56),
		TileDataLength:        u64(64),
		AddressedTiles:        u64(72),
		TileEntries:           u64(80),
		TileContents:          u64(88),
		Clustered:             data[96] == 1,
		InternalCompression:   Compression(data[97]),
		TileCompression:       Compression(data[98]),
		TileType:              TileType(data[99]),
		MinZoom:               data[100],
		MaxZoom:               data[101],
		MinLon:                degrees(102),
		MinLat:                degrees(106),
		MaxLon:                degrees(110),
		MaxLat:                degrees(114),
		CenterZoom:            data[118],
		CenterLon:             degrees(119),
		CenterLat:             degrees(123),
	}, nil
}
