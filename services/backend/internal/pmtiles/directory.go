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
func decodeDirectory(data []byte) ([]entry, error) {
	reader := bytes.NewReader(data)
	count, err := binary.ReadUvarint(reader)
	if err != nil {
		return nil, fmt.Errorf("decodeDirectory: entry count: %w: %w", ErrInvalidDirectory, err)
	}
	// every entry takes at least minEntryLength bytes after the count, so a larger count is corrupt;
	// checked before allocating
	if count > uint64(reader.Len())/minEntryLength {
		return nil, fmt.Errorf("decodeDirectory [count=%d, bytes=%d]: %w", count, len(data), ErrInvalidDirectory)
	}

	entries := make([]entry, count)
	readColumn := func(column string, assign func(index int, value uint64) error) error {
		for index := range entries {
			value, err := binary.ReadUvarint(reader)
			if err != nil {
				return fmt.Errorf("decodeDirectory [column=%s, index=%d]: %w: %w", column, index, ErrInvalidDirectory, err)
			}
			err = assign(index, value)
			if err != nil {
				return fmt.Errorf("decodeDirectory [column=%s, index=%d, value=%d]: %w", column, index, value, err)
			}
		}
		return nil
	}

	// tile IDs are stored as deltas from the previous entry and must strictly increase
	var tileID uint64
	err = readColumn("tile_id", func(index int, delta uint64) error {
		if index > 0 && delta == 0 {
			return fmt.Errorf("tile IDs not strictly increasing: %w", ErrInvalidDirectory)
		}
		if delta > math.MaxUint64-tileID {
			return fmt.Errorf("tile ID overflow: %w", ErrInvalidDirectory)
		}
		tileID += delta
		entries[index].TileID = tileID
		return nil
	})
	if err != nil {
		return nil, err
	}
	err = readColumn("run_length", func(index int, value uint64) error {
		entries[index].RunLength = value
		return nil
	})
	if err != nil {
		return nil, err
	}
	err = readColumn("length", func(index int, value uint64) error {
		entries[index].Length = value
		return nil
	})
	if err != nil {
		return nil, err
	}
	// offset 0 after the first entry means "directly after the previous entry", otherwise offset+1
	err = readColumn("offset", func(index int, value uint64) error {
		switch {
		case value == 0 && index == 0:
			return fmt.Errorf("first entry has no explicit offset: %w", ErrInvalidDirectory)
		case value == 0:
			previous := entries[index-1]
			entries[index].Offset = previous.Offset + previous.Length // checked below for the previous entry
		default:
			entries[index].Offset = value - 1
		}
		if entries[index].Length > math.MaxUint64-entries[index].Offset {
			return fmt.Errorf("offset + length overflow: %w", ErrInvalidDirectory)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return entries, nil
}

// findEntry returns the entry with the largest TileID <= tileID that covers it
// (a tile run containing tileID, or a leaf directory)
func findEntry(entries []entry, tileID uint64) (entry, bool) {
	// first entry with TileID > tileID, then step back
	index := sort.Search(len(entries), func(i int) bool { return entries[i].TileID > tileID }) - 1
	if index < 0 {
		return entry{}, false
	}
	candidate := entries[index]
	if candidate.RunLength == 0 || tileID-candidate.TileID < candidate.RunLength {
		return candidate, true
	}
	return entry{}, false
}

// directoryCache is a mutex-guarded LRU of decoded leaf directories keyed by offset,
// bounded by the total number of cached entries
type directoryCache struct {
	mutex      sync.Mutex
	maxEntries int
	entries    int        // total entries over all cached directories
	order      *list.List // front = most recently used; values are *cachedDirectory
	items      map[uint64]*list.Element
}

type cachedDirectory struct {
	offset  uint64
	entries []entry
}

func newDirectoryCache(maxEntries int) *directoryCache {
	return &directoryCache{maxEntries: maxEntries, order: list.New(), items: make(map[uint64]*list.Element)}
}

func (c *directoryCache) get(offset uint64) ([]entry, bool) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	element, ok := c.items[offset]
	if !ok {
		return nil, false
	}
	c.order.MoveToFront(element)
	return element.Value.(*cachedDirectory).entries, true
}

func (c *directoryCache) put(offset uint64, entries []entry) {
	// a directory larger than the whole budget is not cached
	if len(entries) > c.maxEntries {
		return
	}
	c.mutex.Lock()
	defer c.mutex.Unlock()
	// a concurrent load may already have stored it
	if element, ok := c.items[offset]; ok {
		c.order.MoveToFront(element)
		return
	}
	c.items[offset] = c.order.PushFront(&cachedDirectory{offset: offset, entries: entries})
	c.entries += len(entries)
	// evict least recently used directories until within budget
	for c.entries > c.maxEntries {
		oldest := c.order.Back()
		evicted := oldest.Value.(*cachedDirectory)
		c.order.Remove(oldest)
		delete(c.items, evicted.offset)
		c.entries -= len(evicted.entries)
	}
}

// size returns the number of cached directories and their total entries
func (c *directoryCache) size() (directories, entries int) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	return c.order.Len(), c.entries
}
