// Package pmtilestest builds small synthetic PMTiles v3 archives for tests.
package pmtilestest

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"fmt"
	"math"
	"sort"

	"github.com/ivanov-gv/cg-map/services/backend/internal/pmtiles"
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

	MinZoom, MaxZoom               uint8
	MinLon, MinLat, MaxLon, MaxLat float64
	CenterZoom                     uint8
	CenterLon, CenterLat           float64
}

type entry struct {
	tileID, offset, length, runLength uint64
}

// Build encodes tiles into an archive: header | root directory | metadata | leaf directories | tile data.
// Identical tile contents are stored once; consecutive IDs with identical contents become one run.
func Build(tiles []Tile, options Options) ([]byte, error) {
	if options.InternalCompression == pmtiles.CompressionUnknown {
		options.InternalCompression = pmtiles.CompressionNone
	}

	// sort tiles by tile ID
	type addressed struct {
		id   uint64
		data []byte
	}
	sorted := make([]addressed, 0, len(tiles))
	for _, tile := range tiles {
		id, err := pmtiles.ZxyToID(tile.Z, tile.X, tile.Y)
		if err != nil {
			return nil, fmt.Errorf("pmtiles.ZxyToID [z=%d, x=%d, y=%d]: %w", tile.Z, tile.X, tile.Y, err)
		}
		sorted = append(sorted, addressed{id: id, data: tile.Data})
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].id < sorted[j].id })

	// write tile data with content deduplication and run-length merging
	var tileData bytes.Buffer
	contentOffsets := map[string]uint64{}
	var entries []entry
	for _, tile := range sorted {
		offset, ok := contentOffsets[string(tile.data)]
		if !ok {
			offset = uint64(tileData.Len())
			contentOffsets[string(tile.data)] = offset
			tileData.Write(tile.data)
		}
		if count := len(entries); count > 0 {
			last := &entries[count-1]
			if last.offset == offset && last.tileID+last.runLength == tile.id {
				last.runLength++
				continue
			}
		}
		entries = append(entries, entry{tileID: tile.id, offset: offset, length: uint64(len(tile.data)), runLength: 1})
	}

	// build LeafDepth levels of leaf directories bottom-up when requested
	root := entries
	var leafDirectories bytes.Buffer
	if options.LeafSize > 0 {
		depth := max(options.LeafDepth, 1)
		for level := 0; level < depth; level++ {
			var parents []entry
			for start := 0; start < len(root); start += options.LeafSize {
				end := min(start+options.LeafSize, len(root))
				encoded, err := encodeDirectory(root[start:end], options.InternalCompression)
				if err != nil {
					return nil, err
				}
				parents = append(parents, entry{tileID: root[start].tileID, offset: uint64(leafDirectories.Len()), length: uint64(len(encoded))})
				leafDirectories.Write(encoded)
			}
			root = parents
		}
	}
	rootDirectory, err := encodeDirectory(root, options.InternalCompression)
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
		compressed, err := compress(options.RawLeafDirectories, options.InternalCompression)
		if err != nil {
			return nil, err
		}
		leafDirectories.Reset()
		leafDirectories.Write(compressed)
	}
	var metadata []byte
	if options.Metadata != "" {
		metadata, err = compress([]byte(options.Metadata), options.InternalCompression)
		if err != nil {
			return nil, err
		}
	}

	// header
	header := make([]byte, pmtiles.HeaderLength)
	copy(header, "PMTiles")
	header[7] = 3
	rootOffset := uint64(pmtiles.HeaderLength)
	metadataOffset := rootOffset + uint64(len(rootDirectory))
	leafOffset := metadataOffset + uint64(len(metadata))
	tileDataOffset := leafOffset + uint64(leafDirectories.Len())
	putU64 := func(offset int, value uint64) { binary.LittleEndian.PutUint64(header[offset:], value) }
	putE7 := func(offset int, degrees float64) {
		binary.LittleEndian.PutUint32(header[offset:], uint32(int32(math.Round(degrees*1e7))))
	}
	putU64(8, rootOffset)
	putU64(16, uint64(len(rootDirectory)))
	putU64(24, metadataOffset)
	putU64(32, uint64(len(metadata)))
	putU64(40, leafOffset)
	putU64(48, uint64(leafDirectories.Len()))
	putU64(56, tileDataOffset)
	putU64(64, uint64(tileData.Len()))
	putU64(72, uint64(len(sorted)))
	putU64(80, uint64(len(entries)))
	putU64(88, uint64(len(contentOffsets)))
	header[96] = 1
	header[97] = byte(options.InternalCompression)
	header[98] = byte(options.TileCompression)
	header[99] = byte(options.TileType)
	header[100] = options.MinZoom
	header[101] = options.MaxZoom
	putE7(102, options.MinLon)
	putE7(106, options.MinLat)
	putE7(110, options.MaxLon)
	putE7(114, options.MaxLat)
	header[118] = options.CenterZoom
	putE7(119, options.CenterLon)
	putE7(123, options.CenterLat)

	archive := bytes.Join([][]byte{header, rootDirectory, metadata, leafDirectories.Bytes(), tileData.Bytes()}, nil)
	return archive, nil
}

// encodeDirectory serializes entries column-wise and compresses the result
func encodeDirectory(entries []entry, compression pmtiles.Compression) ([]byte, error) {
	var raw []byte
	raw = binary.AppendUvarint(raw, uint64(len(entries)))
	var previousID uint64
	for _, e := range entries {
		raw = binary.AppendUvarint(raw, e.tileID-previousID)
		previousID = e.tileID
	}
	for _, e := range entries {
		raw = binary.AppendUvarint(raw, e.runLength)
	}
	for _, e := range entries {
		raw = binary.AppendUvarint(raw, e.length)
	}
	for i, e := range entries {
		// 0 means contiguous with the previous entry
		if i > 0 && e.offset == entries[i-1].offset+entries[i-1].length {
			raw = binary.AppendUvarint(raw, 0)
			continue
		}
		raw = binary.AppendUvarint(raw, e.offset+1)
	}
	return compress(raw, compression)
}

// Gzip compresses data with gzip
func Gzip(data []byte) []byte {
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	_, _ = writer.Write(data)
	_ = writer.Close()
	return buffer.Bytes()
}

func compress(data []byte, compression pmtiles.Compression) ([]byte, error) {
	switch compression {
	case pmtiles.CompressionNone:
		return data, nil
	case pmtiles.CompressionGzip:
		return Gzip(data), nil
	}
	return nil, fmt.Errorf("compress [compression=%s]: %w", compression, pmtiles.ErrUnsupportedCompression)
}
