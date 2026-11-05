// Package pmtiles reads tiles and metadata from a local PMTiles v3 archive.
package pmtiles

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"os"
)

// Archive is a read-only PMTiles v3 archive, safe for concurrent use
type Archive struct {
	reader        io.ReaderAt
	size          uint64
	closer        io.Closer
	header        Header
	rootDirectory []entry
	leafCache     *directoryCache
}

// Open opens the PMTiles archive at path; Close releases the file
func Open(path string) (*Archive, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("os.Open [path='%s']: %w", path, err)
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("file.Stat [path='%s']: %w", path, err)
	}
	archive, err := NewArchive(file, info.Size())
	if err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("NewArchive [path='%s']: %w", path, err)
	}
	archive.closer = file
	return archive, nil
}

// NewArchive reads the header and root directory of an archive of the given size from reader
func NewArchive(reader io.ReaderAt, size int64) (*Archive, error) {
	if size < HeaderBytes {
		return nil, fmt.Errorf("NewArchive [size=%d]: %w", size, ErrInvalidMagic)
	}
	archive := &Archive{reader: reader, size: uint64(size), leafCache: newDirectoryCache(leafCacheMaxEntries)}

	// read and validate the header
	headerData := make([]byte, HeaderBytes)
	_, err := reader.ReadAt(headerData, 0)
	if err != nil {
		return nil, fmt.Errorf("ReadAt header: %w", err)
	}
	archive.header, err = decodeHeader(headerData)
	if err != nil {
		return nil, fmt.Errorf("decodeHeader: %w", err)
	}
	if !isSupportedInternalCompression(archive.header.InternalCompression) {
		return nil, fmt.Errorf("NewArchive [internal_compression=%s]: %w", archive.header.InternalCompression, ErrUnsupportedCompression)
	}
	err = archive.validateSections()
	if err != nil {
		return nil, fmt.Errorf("validateSections: %w", err)
	}

	// read the root directory once; it is kept for the archive lifetime
	archive.rootDirectory, err = archive.readDirectory(archive.header.RootDirectoryOffset, archive.header.RootDirectoryLength)
	if err != nil {
		return nil, fmt.Errorf("readDirectory root: %w", err)
	}
	return archive, nil
}

// validateSections checks that every header section lies inside the archive,
// so later offset additions cannot overflow or point outside the file
func (a *Archive) validateSections() error {
	sections := []struct {
		name           string
		offset, length uint64
	}{
		{"root_directory", a.header.RootDirectoryOffset, a.header.RootDirectoryLength},
		{"metadata", a.header.MetadataOffset, a.header.MetadataLength},
		{"leaf_directories", a.header.LeafDirectoriesOffset, a.header.LeafDirectoriesLength},
		{"tile_data", a.header.TileDataOffset, a.header.TileDataLength},
	}
	for _, section := range sections {
		if !fitsWithin(section.offset, section.length, a.size) {
			return fmt.Errorf("validateSections [section=%s, offset=%d, length=%d, size=%d]: %w",
				section.name, section.offset, section.length, a.size, ErrSectionOutOfBounds)
		}
	}
	return nil
}

// Close closes the underlying file when the archive was created by Open
func (a *Archive) Close() error {
	if a.closer == nil {
		return nil
	}
	return a.closer.Close()
}

// Header returns the decoded archive header
func (a *Archive) Header() Header {
	return a.header
}

// Metadata returns the decompressed JSON metadata, or {} when the archive has none
func (a *Archive) Metadata() (json.RawMessage, error) {
	if a.header.MetadataLength == 0 {
		return json.RawMessage("{}"), nil
	}
	compressed, err := a.readSection(a.header.MetadataOffset, a.header.MetadataLength, maxSectionBytes)
	if err != nil {
		return nil, fmt.Errorf("readSection metadata: %w", err)
	}
	metadata, err := decompress(compressed, a.header.InternalCompression, maxMetadataBytes)
	if err != nil {
		return nil, fmt.Errorf("decompress metadata: %w", err)
	}
	if !json.Valid(metadata) {
		return nil, ErrInvalidMetadata
	}
	return json.RawMessage(metadata), nil
}

// Tile returns the tile bytes exactly as stored (see Header().TileCompression).
// isFound is false for valid coordinates without a tile, including zooms outside the archive range.
func (a *Archive) Tile(z uint8, x, y uint32) (tileBytes []byte, isFound bool, err error) {
	tileID, err := TileID(z, x, y)
	if err != nil {
		return nil, false, err
	}
	if z < a.header.MinZoom || z > a.header.MaxZoom {
		return nil, false, nil
	}

	// walk root -> leaf directories until a tile run covers tileID
	directory := a.rootDirectory
	for depth := 0; depth < maxDirectoryDepth; depth++ {
		match, isCovered := findEntry(directory, tileID)
		if !isCovered {
			return nil, false, nil
		}
		if match.RunLength > 0 {
			tileBytes, err = a.readTile(match)
			if err != nil {
				return nil, false, fmt.Errorf("readTile [z=%d, x=%d, y=%d]: %w", z, x, y, err)
			}
			return tileBytes, true, nil
		}
		directory, err = a.leafDirectory(match)
		if err != nil {
			return nil, false, fmt.Errorf("leafDirectory [z=%d, x=%d, y=%d, depth=%d]: %w", z, x, y, depth, err)
		}
	}
	return nil, false, fmt.Errorf("Tile [z=%d, x=%d, y=%d]: %w", z, x, y, ErrMaxDirectoryDepth)
}

// readTile reads one tile run entry from the tile data section
func (a *Archive) readTile(tile entry) ([]byte, error) {
	if !fitsWithin(tile.Offset, tile.Length, a.header.TileDataLength) {
		return nil, fmt.Errorf("readTile [offset=%d, length=%d]: %w", tile.Offset, tile.Length, ErrSectionOutOfBounds)
	}
	return a.readSection(a.header.TileDataOffset+tile.Offset, tile.Length, maxTileBytes)
}

// leafDirectory returns a decoded leaf directory, from cache when possible
func (a *Archive) leafDirectory(leaf entry) ([]entry, error) {
	if !fitsWithin(leaf.Offset, leaf.Length, a.header.LeafDirectoriesLength) {
		return nil, fmt.Errorf("leafDirectory [offset=%d, length=%d]: %w", leaf.Offset, leaf.Length, ErrSectionOutOfBounds)
	}
	if cached, isCached := a.leafCache.get(leaf.Offset); isCached {
		return cached, nil
	}
	entries, err := a.readDirectory(a.header.LeafDirectoriesOffset+leaf.Offset, leaf.Length)
	if err != nil {
		return nil, err
	}
	// an empty leaf directory is invalid per the reference implementation
	if len(entries) == 0 {
		return nil, fmt.Errorf("leafDirectory [offset=%d]: empty: %w", leaf.Offset, ErrInvalidDirectory)
	}
	a.leafCache.put(leaf.Offset, entries)
	return entries, nil
}

// readDirectory reads, decompresses and decodes a directory at an absolute offset
func (a *Archive) readDirectory(offset, length uint64) ([]entry, error) {
	compressed, err := a.readSection(offset, length, maxSectionBytes)
	if err != nil {
		return nil, fmt.Errorf("readSection [offset=%d, length=%d]: %w", offset, length, err)
	}
	decompressed, err := decompress(compressed, a.header.InternalCompression, maxDirectoryBytes)
	if err != nil {
		return nil, fmt.Errorf("decompress [offset=%d]: %w", offset, err)
	}
	return decodeDirectory(decompressed)
}

// readSection reads length bytes at an absolute offset after bounds checks
func (a *Archive) readSection(offset, length, maxBytes uint64) ([]byte, error) {
	if !fitsWithin(offset, length, a.size) {
		return nil, fmt.Errorf("readSection [offset=%d, length=%d, size=%d]: %w", offset, length, a.size, ErrSectionOutOfBounds)
	}
	if length > maxBytes {
		return nil, fmt.Errorf("readSection [length=%d, maxBytes=%d]: %w", length, maxBytes, ErrSectionTooLarge)
	}
	section := make([]byte, length)
	_, err := a.reader.ReadAt(section, int64(offset))
	if err != nil {
		return nil, fmt.Errorf("ReadAt [offset=%d, length=%d]: %w", offset, length, err)
	}
	return section, nil
}

// fitsWithin reports whether [offset, offset+length) lies inside a range of the given size.
// It subtracts instead of adding, so corrupt header values cannot overflow.
func fitsWithin(offset, length, size uint64) bool {
	return offset <= size && length <= size-offset
}

func isSupportedInternalCompression(compression Compression) bool {
	return compression == CompressionNone || compression == CompressionGzip
}

// decompress decodes an internal section of at most maxBytes decompressed bytes
func decompress(section []byte, compression Compression, maxBytes int) ([]byte, error) {
	switch compression {
	case CompressionNone:
		if len(section) > maxBytes {
			return nil, fmt.Errorf("decompress [length=%d, maxBytes=%d]: %w", len(section), maxBytes, ErrSectionTooLarge)
		}
		return section, nil
	case CompressionGzip:
		gzipReader, err := gzip.NewReader(bytes.NewReader(section))
		if err != nil {
			return nil, fmt.Errorf("gzip.NewReader: %w", err)
		}
		defer func() { _ = gzipReader.Close() }()
		// read one byte past the limit to tell "exactly at the limit" from "too large"
		decompressed, err := io.ReadAll(io.LimitReader(gzipReader, int64(maxBytes)+1))
		if err != nil {
			return nil, fmt.Errorf("gzip read: %w", err)
		}
		if len(decompressed) > maxBytes {
			return nil, fmt.Errorf("decompress [maxBytes=%d]: %w", maxBytes, ErrSectionTooLarge)
		}
		return decompressed, nil
	}
	return nil, fmt.Errorf("decompress [compression=%s]: %w", compression, ErrUnsupportedCompression)
}
