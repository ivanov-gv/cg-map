// Package pmtilestest builds small synthetic PMTiles v3 archives for tests.
package pmtilestest

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"fmt"
	"math"
	"sort"

	"github.com/ivanov-gv/cg-map/services/backend/internal/client/pmtiles"
)

// Tile is one tile to store; Data is written as given (already compressed if TileCompression says so)
type Tile struct {
	Z    uint8
	X, Y uint32
	Data []byte
}

// Options control the archive layout and header values
type Options struct {
	InternalCompression pmtiles.Compression // none or gzip; zero value means none
	TileCompression     pmtiles.Compression
	TileType            pmtiles.TileType
	Metadata            string // JSON; empty means no metadata section
	// LeafSize > 0 splits tile entries into leaf directories of at most LeafSize entries
	LeafSize int
	// LeafDepth is the number of leaf levels below the root when LeafSize > 0; zero value means 1
	LeafDepth int
	// RawRootDirectory, when set, replaces the encoded root directory (before internal compression)
	RawRootDirectory []byte
	// RawLeafDirectories, when set, replaces the leaf directory section (before internal compression);
	// root entries must then be given with RawRootDirectory
	RawLeafDirectories []byte

	MinZoom, MaxZoom                                     uint8
	MinLongitude, MinLatitude, MaxLongitude, MaxLatitude float64
	CenterZoom                                           uint8
	CenterLongitude, CenterLatitude                      float64
}

// entry is one directory entry; runLength == 0 points to a leaf directory
type entry struct {
	tileID, offset, length, runLength uint64
}

// addressedTile is a tile's content with its PMTiles tile ID.
type addressedTile struct {
	id   uint64
	data []byte
}

// archiveSections holds the encoded sections in file order, after the header.
type archiveSections struct {
	rootDirectory   []byte
	metadata        []byte
	leafDirectories []byte
	tileData        []byte
}

// tileCounts are the header's three tile statistics.
type tileCounts struct {
	addressed, entries, contents int
}

// Build encodes tiles into an archive: header | root directory | metadata | leaf directories | tile data.
// Identical tile contents are stored once; consecutive IDs with identical contents become one run.
func Build(tiles []Tile, options Options) ([]byte, error) {
	if options.InternalCompression == pmtiles.CompressionUnknown {
		options.InternalCompression = pmtiles.CompressionNone
	}

	sortedTiles, err := sortByTileID(tiles)
	if err != nil {
		return nil, err
	}
	tileData, tileEntries, contentCount := writeTileData(sortedTiles)
	rootEntries, leafDirectories, err := buildLeafDirectories(tileEntries, options)
	if err != nil {
		return nil, err
	}

	// encode the root directory, or use the test's raw replacement
	rootDirectory, err := encodeDirectory(rootEntries, options.InternalCompression)
	if err != nil {
		return nil, err
	}
	if options.RawRootDirectory != nil {
		rootDirectory, err = compress(options.RawRootDirectory, options.InternalCompression)
		if err != nil {
			return nil, err
		}
	}
	if options.RawLeafDirectories != nil {
		leafDirectories, err = compress(options.RawLeafDirectories, options.InternalCompression)
		if err != nil {
			return nil, err
		}
	}
	var metadata []byte
	if options.Metadata != "" {
		metadata, err = compress([]byte(options.Metadata), options.InternalCompression)
		if err != nil {
			return nil, err
		}
	}

	sections := archiveSections{rootDirectory: rootDirectory, metadata: metadata, leafDirectories: leafDirectories, tileData: tileData}
	counts := tileCounts{addressed: len(sortedTiles), entries: len(tileEntries), contents: contentCount}
	header := encodeHeader(sections, counts, options)
	archive := bytes.Join([][]byte{header, rootDirectory, metadata, leafDirectories, tileData}, nil)
	return archive, nil
}

// sortByTileID returns the tiles ordered by tile ID, as directories require.
func sortByTileID(tiles []Tile) ([]addressedTile, error) {
	sortedTiles := make([]addressedTile, 0, len(tiles))
	for _, tile := range tiles {
		id, err := pmtiles.TileID(tile.Z, tile.X, tile.Y)
		if err != nil {
			return nil, fmt.Errorf("pmtiles.TileID [z=%d, x=%d, y=%d]: %w", tile.Z, tile.X, tile.Y, err)
		}
		sortedTiles = append(sortedTiles, addressedTile{id: id, data: tile.Data})
	}
	sort.Slice(sortedTiles, func(left, right int) bool { return sortedTiles[left].id < sortedTiles[right].id })
	return sortedTiles, nil
}

// writeTileData writes tile contents with deduplication and run-length merging.
// It returns the tile data section, its directory entries and the number of distinct contents.
func writeTileData(sortedTiles []addressedTile) (tileData []byte, entries []entry, contentCount int) {
	var buffer bytes.Buffer
	offsetsByContent := map[string]uint64{}
	for _, tile := range sortedTiles {
		offset, isStored := offsetsByContent[string(tile.data)]
		if !isStored {
			offset = uint64(buffer.Len())
			offsetsByContent[string(tile.data)] = offset
			buffer.Write(tile.data)
		}
		if len(entries) > 0 {
			lastEntry := &entries[len(entries)-1]
			if lastEntry.offset == offset && lastEntry.tileID+lastEntry.runLength == tile.id {
				lastEntry.runLength++
				continue
			}
		}
		entries = append(entries, entry{tileID: tile.id, offset: offset, length: uint64(len(tile.data)), runLength: 1})
	}
	return buffer.Bytes(), entries, len(offsetsByContent)
}

// buildLeafDirectories builds LeafDepth levels of leaf directories bottom-up when requested.
// It returns the entries left for the root directory and the leaf directory section.
func buildLeafDirectories(tileEntries []entry, options Options) (rootEntries []entry, leafDirectories []byte, err error) {
	rootEntries = tileEntries
	if options.LeafSize <= 0 {
		return rootEntries, nil, nil
	}
	var buffer bytes.Buffer
	depth := max(options.LeafDepth, 1)
	for level := 0; level < depth; level++ {
		var parentEntries []entry
		for start := 0; start < len(rootEntries); start += options.LeafSize {
			end := min(start+options.LeafSize, len(rootEntries))
			encoded, err := encodeDirectory(rootEntries[start:end], options.InternalCompression)
			if err != nil {
				return nil, nil, err
			}
			parentEntries = append(parentEntries, entry{tileID: rootEntries[start].tileID, offset: uint64(buffer.Len()), length: uint64(len(encoded))})
			buffer.Write(encoded)
		}
		rootEntries = parentEntries
	}
	return rootEntries, buffer.Bytes(), nil
}

// encodeHeader writes the fixed-size header. The numbers are byte offsets from the PMTiles v3 header layout.
//
//nolint:mnd // byte offsets and units from the PMTiles v3 header layout
func encodeHeader(sections archiveSections, counts tileCounts, options Options) []byte {
	header := make([]byte, pmtiles.HeaderBytes)
	copy(header, "PMTiles")
	header[7] = 3
	rootOffset := uint64(pmtiles.HeaderBytes)
	metadataOffset := rootOffset + uint64(len(sections.rootDirectory))
	leafOffset := metadataOffset + uint64(len(sections.metadata))
	tileDataOffset := leafOffset + uint64(len(sections.leafDirectories))
	putUint64 := func(offset int, value uint64) { binary.LittleEndian.PutUint64(header[offset:], value) }
	// positions are stored as signed integers in units of 1e-7 degrees
	putDegrees := func(offset int, degrees float64) {
		binary.LittleEndian.PutUint32(header[offset:], uint32(int32(math.Round(degrees*1e7))))
	}
	putUint64(8, rootOffset)
	putUint64(16, uint64(len(sections.rootDirectory)))
	putUint64(24, metadataOffset)
	putUint64(32, uint64(len(sections.metadata)))
	putUint64(40, leafOffset)
	putUint64(48, uint64(len(sections.leafDirectories)))
	putUint64(56, tileDataOffset)
	putUint64(64, uint64(len(sections.tileData)))
	putUint64(72, uint64(counts.addressed))
	putUint64(80, uint64(counts.entries))
	putUint64(88, uint64(counts.contents))
	header[96] = 1 // clustered: tiles are written in tile ID order
	header[97] = byte(options.InternalCompression)
	header[98] = byte(options.TileCompression)
	header[99] = byte(options.TileType)
	header[100] = options.MinZoom
	header[101] = options.MaxZoom
	putDegrees(102, options.MinLongitude)
	putDegrees(106, options.MinLatitude)
	putDegrees(110, options.MaxLongitude)
	putDegrees(114, options.MaxLatitude)
	header[118] = options.CenterZoom
	putDegrees(119, options.CenterLongitude)
	putDegrees(123, options.CenterLatitude)
	return header
}

// encodeDirectory serializes entries column-wise and compresses the result
func encodeDirectory(entries []entry, compression pmtiles.Compression) ([]byte, error) {
	var encoded []byte
	encoded = binary.AppendUvarint(encoded, uint64(len(entries)))
	var previousID uint64
	for _, directoryEntry := range entries {
		encoded = binary.AppendUvarint(encoded, directoryEntry.tileID-previousID)
		previousID = directoryEntry.tileID
	}
	for _, directoryEntry := range entries {
		encoded = binary.AppendUvarint(encoded, directoryEntry.runLength)
	}
	for _, directoryEntry := range entries {
		encoded = binary.AppendUvarint(encoded, directoryEntry.length)
	}
	for index, directoryEntry := range entries {
		// 0 means contiguous with the previous entry
		if index > 0 && directoryEntry.offset == entries[index-1].offset+entries[index-1].length {
			encoded = binary.AppendUvarint(encoded, 0)
			continue
		}
		encoded = binary.AppendUvarint(encoded, directoryEntry.offset+1)
	}
	return compress(encoded, compression)
}

// Gzip compresses data with gzip
func Gzip(data []byte) []byte {
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	_, _ = writer.Write(data)
	_ = writer.Close()
	return buffer.Bytes()
}

// compress applies an internal section compression.
func compress(data []byte, compression pmtiles.Compression) ([]byte, error) {
	switch compression {
	case pmtiles.CompressionNone:
		return data, nil
	case pmtiles.CompressionGzip:
		return Gzip(data), nil
	}
	return nil, fmt.Errorf("compress [compression=%s]: %w", compression, pmtiles.ErrUnsupportedCompression)
}
