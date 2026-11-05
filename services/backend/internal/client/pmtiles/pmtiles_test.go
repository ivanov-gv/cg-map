package pmtiles_test

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"

	"github.com/ivanov-gv/cg-map/services/backend/internal/client/pmtiles"
	"github.com/ivanov-gv/cg-map/services/backend/internal/client/pmtiles/pmtilestest"
)

func TestTileID(t *testing.T) {
	// expected values from the pmtiles JS reference implementation (zxyToTileId, v4.3.0)
	tests := []struct {
		z    uint8
		x, y uint32
		want uint64
	}{
		{0, 0, 0, 0},
		{1, 0, 0, 1},
		{1, 0, 1, 2},
		{1, 1, 1, 3},
		{1, 1, 0, 4},
		{2, 0, 0, 5},
		{2, 1, 3, 11},
		{3, 7, 0, 84},
		{12, 2267, 1513, 19815643},
		{14, 9068, 6055, 317050308},
		{20, 1000000, 1048575, 1098348673706},
		{26, 67108863, 0, 6004799503160660},
	}
	for _, test := range tests {
		t.Run(fmt.Sprintf("%d/%d/%d", test.z, test.x, test.y), func(t *testing.T) {
			got, err := pmtiles.TileID(test.z, test.x, test.y)
			if err != nil {
				t.Fatalf("TileID: %v", err)
			}
			if got != test.want {
				t.Fatalf("TileID = %d, want %d", got, test.want)
			}
		})
	}
}

func TestTileIDInvalid(t *testing.T) {
	tests := []struct {
		name string
		z    uint8
		x, y uint32
	}{
		{"x beyond zoom 0", 0, 1, 0},
		{"y beyond zoom 0", 0, 0, 1},
		{"x beyond zoom 3", 3, 8, 0},
		{"zoom too deep", pmtiles.MaxZoom + 1, 0, 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := pmtiles.TileID(test.z, test.x, test.y)
			if !errors.Is(err, pmtiles.ErrInvalidTileCoordinates) {
				t.Fatalf("err = %v, want ErrInvalidTileCoordinates", err)
			}
		})
	}
}

// sampleTiles has a run of identical tiles (zoom 1), a shared content, and distinct tiles
func sampleTiles() []pmtilestest.Tile {
	tiles := []pmtilestest.Tile{{Z: 0, X: 0, Y: 0, Data: []byte("root")}}
	for _, xy := range [][2]uint32{{0, 0}, {0, 1}, {1, 1}, {1, 0}} {
		tiles = append(tiles, pmtilestest.Tile{Z: 1, X: xy[0], Y: xy[1], Data: []byte("ocean")})
	}
	for x := uint32(0); x < 4; x++ {
		tiles = append(tiles, pmtilestest.Tile{Z: 2, X: x, Y: 1, Data: []byte(fmt.Sprintf("z2-%d", x))})
	}
	tiles = append(tiles, pmtilestest.Tile{Z: 2, X: 3, Y: 3, Data: []byte("root")})
	return tiles
}

func TestArchive(t *testing.T) {
	layouts := []struct {
		name    string
		options pmtilestest.Options
	}{
		{"root only, uncompressed", pmtilestest.Options{InternalCompression: pmtiles.CompressionNone}},
		{"root only, gzip", pmtilestest.Options{InternalCompression: pmtiles.CompressionGzip}},
		{"leaf directories, uncompressed", pmtilestest.Options{InternalCompression: pmtiles.CompressionNone, LeafSize: 2}},
		{"leaf directories, gzip", pmtilestest.Options{InternalCompression: pmtiles.CompressionGzip, LeafSize: 2}},
		{"two leaf levels", pmtilestest.Options{InternalCompression: pmtiles.CompressionGzip, LeafSize: 2, LeafDepth: 2}},
		{"three leaf levels (maximum depth)", pmtilestest.Options{InternalCompression: pmtiles.CompressionGzip, LeafSize: 2, LeafDepth: 3}},
	}
	lookups := []struct {
		z         uint8
		x, y      uint32
		wantData  string
		wantFound bool
	}{
		{0, 0, 0, "root", true},
		{1, 0, 0, "ocean", true},
		{1, 1, 0, "ocean", true}, // last tile of the run
		{2, 0, 1, "z2-0", true},
		{2, 3, 1, "z2-3", true},
		{2, 3, 3, "root", true}, // deduplicated content
		{2, 0, 0, "", false},    // between entries
		{2, 2, 2, "", false},
		{3, 0, 0, "", false}, // beyond max zoom
	}
	for _, layout := range layouts {
		t.Run(layout.name, func(t *testing.T) {
			options := layout.options
			options.TileType = pmtiles.TileTypeMVT
			options.TileCompression = pmtiles.CompressionNone
			options.MinZoom, options.MaxZoom = 0, 2
			options.Metadata = `{"name":"sample"}`
			archive := buildArchive(t, sampleTiles(), options)

			for _, lookup := range lookups {
				data, isFound, err := archive.Tile(lookup.z, lookup.x, lookup.y)
				if err != nil {
					t.Fatalf("Tile(%d/%d/%d): %v", lookup.z, lookup.x, lookup.y, err)
				}
				if isFound != lookup.wantFound || string(data) != lookup.wantData {
					t.Fatalf("Tile(%d/%d/%d) = %q, %v; want %q, %v", lookup.z, lookup.x, lookup.y, data, isFound, lookup.wantData, lookup.wantFound)
				}
			}

			metadata, err := archive.Metadata()
			if err != nil {
				t.Fatalf("Metadata: %v", err)
			}
			if string(metadata) != `{"name":"sample"}` {
				t.Fatalf("Metadata = %s", metadata)
			}
		})
	}
}

func TestArchiveInvalidCoordinates(t *testing.T) {
	archive := buildArchive(t, sampleTiles(), pmtilestest.Options{TileType: pmtiles.TileTypeMVT, MaxZoom: 2})
	_, _, err := archive.Tile(2, 4, 0)
	if !errors.Is(err, pmtiles.ErrInvalidTileCoordinates) {
		t.Fatalf("err = %v, want ErrInvalidTileCoordinates", err)
	}
}

func TestArchiveMaxDirectoryDepth(t *testing.T) {
	// root + 4 leaf levels needs 5 directory reads; the limit is 4 like the reference implementation
	archive := buildArchive(t, sampleTiles(), pmtilestest.Options{LeafSize: 2, LeafDepth: 4, MaxZoom: 2})
	_, _, err := archive.Tile(2, 0, 1)
	if !errors.Is(err, pmtiles.ErrMaxDirectoryDepth) {
		t.Fatalf("err = %v, want ErrMaxDirectoryDepth", err)
	}
}

func TestArchiveEmptyLeafDirectory(t *testing.T) {
	// root: one leaf entry {tile 0, run 0, length 1, offset 0 (stored 1)}; leaf: zero entries
	archive := buildArchive(t, nil, pmtilestest.Options{
		MaxZoom:            2,
		RawRootDirectory:   []byte{1, 0, 0, 1, 1},
		RawLeafDirectories: []byte{0},
	})
	_, _, err := archive.Tile(0, 0, 0)
	if !errors.Is(err, pmtiles.ErrInvalidDirectory) {
		t.Fatalf("err = %v, want ErrInvalidDirectory", err)
	}
}

// countingReaderAt counts ReadAt calls per offset
type countingReaderAt struct {
	reader io.ReaderAt
	mutex  sync.Mutex
	reads  map[int64]int
}

func (c *countingReaderAt) ReadAt(buffer []byte, offset int64) (int, error) {
	c.countRead(offset)
	return c.reader.ReadAt(buffer, offset)
}

func (c *countingReaderAt) countRead(offset int64) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	c.reads[offset]++
}

func TestArchiveLeafCache(t *testing.T) {
	// one leaf directory holding every entry
	data, err := pmtilestest.Build(sampleTiles(), pmtilestest.Options{InternalCompression: pmtiles.CompressionGzip, LeafSize: 100, MaxZoom: 2})
	if err != nil {
		t.Fatal(err)
	}
	counter := &countingReaderAt{reader: bytes.NewReader(data), reads: map[int64]int{}}
	archive, err := pmtiles.NewArchive(counter, int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	leafOffset := int64(archive.Header().LeafDirectoriesOffset)

	// two different tiles in the same leaf, the second one twice
	for _, xy := range [][2]uint32{{0, 1}, {3, 1}, {3, 1}} {
		if _, isFound, err := archive.Tile(2, xy[0], xy[1]); err != nil || !isFound {
			t.Fatalf("Tile(2/%d/%d): isFound %v, err %v", xy[0], xy[1], isFound, err)
		}
	}
	if reads := counter.reads[leafOffset]; reads != 1 {
		t.Fatalf("leaf directory read %d times, want 1", reads)
	}
}

func TestArchiveLimits(t *testing.T) {
	tests := []struct {
		name    string
		options pmtilestest.Options
		want    error
	}{
		{
			// the reviewer's case: 2^25 entries announced in a tiny gzipped directory
			name: "huge entry count, gzip",
			options: pmtilestest.Options{InternalCompression: pmtiles.CompressionGzip,
				RawRootDirectory: append(binary.AppendUvarint(nil, 1<<25), make([]byte, 64)...)},
			want: pmtiles.ErrInvalidDirectory,
		},
		{
			name: "decompression bomb root directory",
			options: pmtilestest.Options{InternalCompression: pmtiles.CompressionGzip,
				RawRootDirectory: make([]byte, 3<<20)},
			want: pmtiles.ErrSectionTooLarge,
		},
		{
			name:    "oversized uncompressed root directory",
			options: pmtilestest.Options{RawRootDirectory: make([]byte, 3<<20)},
			want:    pmtiles.ErrSectionTooLarge,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			data, err := pmtilestest.Build(sampleTiles(), test.options)
			if err != nil {
				t.Fatal(err)
			}
			_, err = pmtiles.NewArchive(bytes.NewReader(data), int64(len(data)))
			if !errors.Is(err, test.want) {
				t.Fatalf("err = %v, want %v", err, test.want)
			}
		})
	}
}

func TestMetadataInvalidJSON(t *testing.T) {
	for _, compression := range []pmtiles.Compression{pmtiles.CompressionNone, pmtiles.CompressionGzip} {
		archive := buildArchive(t, sampleTiles(), pmtilestest.Options{InternalCompression: compression, Metadata: `{"name":`})
		_, err := archive.Metadata()
		if !errors.Is(err, pmtiles.ErrInvalidMetadata) {
			t.Errorf("%s: err = %v, want ErrInvalidMetadata", compression, err)
		}
	}
}

func TestHeader(t *testing.T) {
	archive := buildArchive(t, sampleTiles(), pmtilestest.Options{
		InternalCompression: pmtiles.CompressionGzip,
		TileCompression:     pmtiles.CompressionGzip,
		TileType:            pmtiles.TileTypeMVT,
		MinZoom:             0, MaxZoom: 2,
		MinLongitude: 18.4337, MinLatitude: 41.8297, MaxLongitude: 20.3578, MaxLatitude: 43.5585,
		CenterZoom: 9, CenterLongitude: 19.26, CenterLatitude: -42.44,
	})
	header := archive.Header()
	checks := []struct {
		name      string
		got, want any
	}{
		{"spec version", header.SpecVersion, uint8(3)},
		{"internal compression", header.InternalCompression, pmtiles.CompressionGzip},
		{"tile compression", header.TileCompression, pmtiles.CompressionGzip},
		{"tile type", header.TileType, pmtiles.TileTypeMVT},
		{"max zoom", header.MaxZoom, uint8(2)},
		{"min lon", header.MinLongitude, 18.4337},
		{"max lat", header.MaxLatitude, 43.5585},
		{"center zoom", header.CenterZoom, uint8(9)},
		{"center lon", header.CenterLongitude, 19.26},
		{"negative center lat", header.CenterLatitude, -42.44},
		{"addressed tiles", header.AddressedTiles, uint64(10)},
		{"tile entries", header.TileEntries, uint64(7)},
		{"tile contents", header.TileContents, uint64(6)},
	}
	for _, check := range checks {
		if check.got != check.want {
			t.Errorf("%s = %v, want %v", check.name, check.got, check.want)
		}
	}
}

func TestNewArchiveRejects(t *testing.T) {
	valid, err := pmtilestest.Build(sampleTiles(), pmtilestest.Options{MaxZoom: 2})
	if err != nil {
		t.Fatal(err)
	}
	mutate := func(change func(data []byte)) []byte {
		data := bytes.Clone(valid)
		change(data)
		return data
	}
	tests := []struct {
		name string
		data []byte
		want error
	}{
		{"too short", valid[:10], pmtiles.ErrInvalidMagic},
		{"wrong magic", mutate(func(data []byte) { data[0] = 'X' }), pmtiles.ErrInvalidMagic},
		{"version 2", mutate(func(data []byte) { data[7] = 2 }), pmtiles.ErrUnsupportedVersion},
		{"brotli directories", mutate(func(data []byte) { data[97] = byte(pmtiles.CompressionBrotli) }), pmtiles.ErrUnsupportedCompression},
		{"root directory beyond file", mutate(func(data []byte) { binary.LittleEndian.PutUint64(data[16:], 1<<40) }), pmtiles.ErrSectionOutOfBounds},
		{"tile data offset overflows", mutate(func(data []byte) { binary.LittleEndian.PutUint64(data[56:], ^uint64(0)) }), pmtiles.ErrSectionOutOfBounds},
		{"leaf section beyond file", mutate(func(data []byte) { binary.LittleEndian.PutUint64(data[48:], uint64(len(data))) }), pmtiles.ErrSectionOutOfBounds},
		{"corrupt directory", mutate(func(data []byte) { data[pmtiles.HeaderBytes] = 0xff }), pmtiles.ErrInvalidDirectory},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := pmtiles.NewArchive(bytes.NewReader(test.data), int64(len(test.data)))
			if !errors.Is(err, test.want) {
				t.Fatalf("err = %v, want %v", err, test.want)
			}
		})
	}
}

func TestOpenFile(t *testing.T) {
	data, err := pmtilestest.Build(sampleTiles(), pmtilestest.Options{InternalCompression: pmtiles.CompressionGzip, LeafSize: 3, MaxZoom: 2})
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "sample.pmtiles")
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
	}
	archive, err := pmtiles.Open(path)
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer func() { _ = archive.Close() }()

	// concurrent lookups share the leaf cache
	var group sync.WaitGroup
	for worker := 0; worker < 8; worker++ {
		group.Add(1)
		go func() {
			defer group.Done()
			for x := uint32(0); x < 4; x++ {
				data, isFound, err := archive.Tile(2, x, 1)
				if err != nil || !isFound || string(data) != fmt.Sprintf("z2-%d", x) {
					t.Errorf("Tile(2/%d/1) = %q, %v, %v", x, data, isFound, err)
				}
			}
		}()
	}
	group.Wait()

	if _, err := pmtiles.Open(filepath.Join(t.TempDir(), "missing.pmtiles")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Open missing: err = %v", err)
	}
}

func buildArchive(t *testing.T, tiles []pmtilestest.Tile, options pmtilestest.Options) *pmtiles.Archive {
	t.Helper()
	data, err := pmtilestest.Build(tiles, options)
	if err != nil {
		t.Fatalf("pmtilestest.Build: %v", err)
	}
	archive, err := pmtiles.NewArchive(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("NewArchive: %v", err)
	}
	return archive
}
