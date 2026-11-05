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
	MinLongitude float64
	MinLatitude  float64
	MaxLongitude float64
	MaxLatitude  float64

	CenterZoom      uint8
	CenterLongitude float64
	CenterLatitude  float64
}

// decodeHeader parses and validates the first HeaderBytes bytes of an archive
//
//nolint:mnd // byte offsets from the PMTiles v3 header layout
func decodeHeader(headerData []byte) (Header, error) {
	if len(headerData) < HeaderBytes || string(headerData[:len(magic)]) != magic {
		return Header{}, ErrInvalidMagic
	}
	version := headerData[versionOffset]
	if version != specVersion {
		return Header{}, fmt.Errorf("decodeHeader [version=%d]: %w", version, ErrUnsupportedVersion)
	}

	uint64At := func(offset int) uint64 { return binary.LittleEndian.Uint64(headerData[offset:]) }
	// positions are stored as signed integers in units of 1e-7 degrees
	degreesAt := func(offset int) float64 {
		return float64(int32(binary.LittleEndian.Uint32(headerData[offset:]))) / storedUnitsPerDegree
	}

	// the numbers are byte offsets from the PMTiles v3 header layout
	return Header{
		SpecVersion:           version,
		RootDirectoryOffset:   uint64At(8),
		RootDirectoryLength:   uint64At(16),
		MetadataOffset:        uint64At(24),
		MetadataLength:        uint64At(32),
		LeafDirectoriesOffset: uint64At(40),
		LeafDirectoriesLength: uint64At(48),
		TileDataOffset:        uint64At(56),
		TileDataLength:        uint64At(64),
		AddressedTiles:        uint64At(72),
		TileEntries:           uint64At(80),
		TileContents:          uint64At(88),
		Clustered:             headerData[96] == 1,
		InternalCompression:   Compression(headerData[97]),
		TileCompression:       Compression(headerData[98]),
		TileType:              TileType(headerData[99]),
		MinZoom:               headerData[100],
		MaxZoom:               headerData[101],
		MinLongitude:          degreesAt(102),
		MinLatitude:           degreesAt(106),
		MaxLongitude:          degreesAt(110),
		MaxLatitude:           degreesAt(114),
		CenterZoom:            headerData[118],
		CenterLongitude:       degreesAt(119),
		CenterLatitude:        degreesAt(123),
	}, nil
}
