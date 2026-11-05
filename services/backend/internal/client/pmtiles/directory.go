package pmtiles

import (
	"bytes"
	"container/list"
	"encoding/binary"
	"fmt"
	"math"
	"sort"
	"sync"
)

// entry is one decoded directory entry; RunLength == 0 points to a leaf directory
type entry struct {
	TileID    uint64
	Offset    uint64
	Length    uint64
	RunLength uint64
}

// decodeDirectory parses an uncompressed directory: column-wise uvarints for
// tile ID deltas, run lengths, lengths and offsets
func decodeDirectory(encoded []byte) ([]entry, error) {
	reader := bytes.NewReader(encoded)
	entryCount, err := binary.ReadUvarint(reader)
	if err != nil {
		return nil, fmt.Errorf("decodeDirectory: entry count: %w: %w", ErrInvalidDirectory, err)
	}
	// every entry takes at least minEntryBytes bytes after the count, so a larger count is corrupt;
	// checked before allocating
	if entryCount > uint64(reader.Len())/minEntryBytes {
		return nil, fmt.Errorf("decodeDirectory [count=%d, bytes=%d]: %w", entryCount, len(encoded), ErrInvalidDirectory)
	}

	entries := make([]entry, entryCount)
	columns := []struct {
		name   string
		assign func(index int, value uint64) error
	}{
		{"tile_id", tileIDAssigner(entries)},
		{"run_length", func(index int, value uint64) error {
			entries[index].RunLength = value
			return nil
		}},
		{"length", func(index int, value uint64) error {
			entries[index].Length = value
			return nil
		}},
		{"offset", offsetAssigner(entries)},
	}
	for _, column := range columns {
		for index := range entries {
			value, err := binary.ReadUvarint(reader)
			if err != nil {
				return nil, fmt.Errorf("decodeDirectory [column=%s, index=%d]: %w: %w", column.name, index, ErrInvalidDirectory, err)
			}
			err = column.assign(index, value)
			if err != nil {
				return nil, fmt.Errorf("decodeDirectory [column=%s, index=%d, value=%d]: %w", column.name, index, value, err)
			}
		}
	}
	return entries, nil
}

// tileIDAssigner decodes tile IDs, stored as deltas from the previous entry, which must strictly increase.
func tileIDAssigner(entries []entry) func(index int, delta uint64) error {
	var tileID uint64
	return func(index int, delta uint64) error {
		if index > 0 && delta == 0 {
			return fmt.Errorf("tile IDs not strictly increasing: %w", ErrInvalidDirectory)
		}
		if delta > math.MaxUint64-tileID {
			return fmt.Errorf("tile ID overflow: %w", ErrInvalidDirectory)
		}
		tileID += delta
		entries[index].TileID = tileID
		return nil
	}
}

// offsetAssigner decodes offsets. It needs the lengths already decoded: a stored 0 after the first entry
// means "directly after the previous entry", and any other value is the offset plus 1.
func offsetAssigner(entries []entry) func(index int, storedOffset uint64) error {
	return func(index int, storedOffset uint64) error {
		switch {
		case storedOffset == 0 && index == 0:
			return fmt.Errorf("first entry has no explicit offset: %w", ErrInvalidDirectory)
		case storedOffset == 0:
			previous := entries[index-1]
			entries[index].Offset = previous.Offset + previous.Length // checked below for the previous entry
		default:
			entries[index].Offset = storedOffset - 1
		}
		if entries[index].Length > math.MaxUint64-entries[index].Offset {
			return fmt.Errorf("offset + length overflow: %w", ErrInvalidDirectory)
		}
		return nil
	}
}

// findEntry returns the entry with the largest TileID <= tileID that covers it
// (a tile run containing tileID, or a leaf directory)
func findEntry(entries []entry, tileID uint64) (entry, bool) {
	// first entry with TileID > tileID, then step back
	nextIndex := sort.Search(len(entries), func(index int) bool { return entries[index].TileID > tileID })
	if nextIndex == 0 {
		return entry{}, false
	}
	candidate := entries[nextIndex-1]
	if candidate.RunLength == 0 || tileID-candidate.TileID < candidate.RunLength {
		return candidate, true
	}
	return entry{}, false
}

// directoryCache is a mutex-guarded LRU of decoded leaf directories keyed by offset,
// bounded by the total number of cached entries
type directoryCache struct {
	mutex            sync.Mutex
	maxEntries       int
	entryCount       int        // total entries over all cached directories
	recentlyUsed     *list.List // front = most recently used; values are *cachedDirectory
	elementsByOffset map[uint64]*list.Element
}

// cachedDirectory keeps the offset so that eviction can remove the map key.
type cachedDirectory struct {
	offset  uint64
	entries []entry
}

func newDirectoryCache(maxEntries int) *directoryCache {
	return &directoryCache{maxEntries: maxEntries, recentlyUsed: list.New(), elementsByOffset: make(map[uint64]*list.Element)}
}

// get returns the cached directory at offset and marks it most recently used.
func (c *directoryCache) get(offset uint64) ([]entry, bool) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	element, isCached := c.elementsByOffset[offset]
	if !isCached {
		return nil, false
	}
	c.recentlyUsed.MoveToFront(element)
	return element.Value.(*cachedDirectory).entries, true
}

// put stores a directory and evicts the least recently used ones beyond the entry budget.
func (c *directoryCache) put(offset uint64, entries []entry) {
	// a directory larger than the whole budget is not cached
	if len(entries) > c.maxEntries {
		return
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	// a concurrent load may already have stored it
	if element, isCached := c.elementsByOffset[offset]; isCached {
		c.recentlyUsed.MoveToFront(element)
		return
	}
	c.elementsByOffset[offset] = c.recentlyUsed.PushFront(&cachedDirectory{offset: offset, entries: entries})
	c.entryCount += len(entries)
	// evict least recently used directories until within budget
	for c.entryCount > c.maxEntries {
		leastRecentlyUsed := c.recentlyUsed.Back()
		evicted := leastRecentlyUsed.Value.(*cachedDirectory)
		c.recentlyUsed.Remove(leastRecentlyUsed)
		delete(c.elementsByOffset, evicted.offset)
		c.entryCount -= len(evicted.entries)
	}
}

// size returns the number of cached directories and their total entries
func (c *directoryCache) size() (directories, entries int) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	return c.recentlyUsed.Len(), c.entryCount
}
