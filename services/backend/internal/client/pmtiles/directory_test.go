package pmtiles

import (
	"bytes"
	"encoding/binary"
	"errors"
	"math"
	"testing"
)

func TestFindEntry(t *testing.T) {
	entries := []entry{
		{TileID: 5, RunLength: 1},
		{TileID: 10, RunLength: 3},
		{TileID: 20, RunLength: 0}, // leaf directory covering 20..
	}
	tests := []struct {
		tileID    uint64
		wantFound bool
		wantID    uint64
	}{
		{4, false, 0},
		{5, true, 5},
		{6, false, 0},
		{10, true, 10},
		{12, true, 10},
		{13, false, 0},
		{20, true, 20},
		{1000, true, 20},
	}
	for _, test := range tests {
		got, isFound := findEntry(entries, test.tileID)
		if isFound != test.wantFound || (isFound && got.TileID != test.wantID) {
			t.Errorf("findEntry(%d) = %+v, %v; want id %d, %v", test.tileID, got, isFound, test.wantID, test.wantFound)
		}
	}
}

func TestDecodeDirectoryOffsets(t *testing.T) {
	// 3 entries; IDs 1, 2, 5; offsets: explicit 0 (stored 1), contiguous (stored 0), explicit 4 (stored 5)
	raw := []byte{3, 1, 1, 3, 1, 1, 1, 2, 2, 7, 1, 0, 5}
	entries, err := decodeDirectory(raw)
	if err != nil {
		t.Fatal(err)
	}
	want := []entry{
		{TileID: 1, RunLength: 1, Length: 2, Offset: 0},
		{TileID: 2, RunLength: 1, Length: 2, Offset: 2},
		{TileID: 5, RunLength: 1, Length: 7, Offset: 4},
	}
	for index := range want {
		if entries[index] != want[index] {
			t.Errorf("entry %d = %+v, want %+v", index, entries[index], want[index])
		}
	}
}

func TestDecodeDirectoryRejects(t *testing.T) {
	maxUint64 := binary.AppendUvarint(nil, math.MaxUint64)
	join := func(parts ...[]byte) []byte { return bytes.Join(parts, nil) }
	tests := []struct {
		name string
		raw  []byte
	}{
		{"empty", nil},
		{"truncated", []byte{3, 1, 1, 3, 1, 1, 1, 2, 2, 7, 1, 0}},
		// 2^25 entries announced in a handful of bytes must fail before allocating
		{"count larger than data", join(binary.AppendUvarint(nil, 1<<25), []byte{1, 1, 1, 1})},
		{"count needs 4 bytes per entry", []byte{2, 1, 1, 1, 1, 1, 1, 1}},
		{"first offset zero", []byte{1, 0, 1, 1, 0}},
		{"repeated tile ID", []byte{2, 1, 0, 1, 1, 1, 1, 1, 0}},
		{"tile ID overflow", join([]byte{2, 1}, maxUint64, []byte{1, 1, 1, 1, 1, 0})},
		{"offset + length overflow", join([]byte{1, 0, 1}, []byte{2}, maxUint64)},
		{"contiguous offset overflow", join([]byte{2, 0, 1, 1, 1}, maxUint64, []byte{1, 1, 0})},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := decodeDirectory(test.raw)
			if !errors.Is(err, ErrInvalidDirectory) {
				t.Fatalf("err = %v, want ErrInvalidDirectory", err)
			}
		})
	}
}

func TestDirectoryCacheBudget(t *testing.T) {
	cache := newDirectoryCache(4)
	cache.put(1, make([]entry, 2))
	cache.put(2, make([]entry, 2))
	// touch 1 so 2 becomes the least recently used
	if _, isCached := cache.get(1); !isCached {
		t.Fatal("missing 1")
	}
	cache.put(3, make([]entry, 1))
	if _, isCached := cache.get(2); isCached {
		t.Error("2 should have been evicted")
	}
	if _, isCached := cache.get(1); !isCached {
		t.Error("1 should be kept")
	}
	if directories, entries := cache.size(); directories != 2 || entries != 3 {
		t.Errorf("size = %d directories, %d entries; want 2, 3", directories, entries)
	}
	// a directory above the whole budget is not cached and evicts nothing
	cache.put(4, make([]entry, 5))
	if _, isCached := cache.get(4); isCached {
		t.Error("oversized directory cached")
	}
	if directories, entries := cache.size(); directories != 2 || entries != 3 {
		t.Errorf("size after oversized put = %d, %d", directories, entries)
	}
}
