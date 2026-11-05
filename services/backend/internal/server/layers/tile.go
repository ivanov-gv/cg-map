package layers

import (
	"bytes"
	"compress/gzip"
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/ivanov-gv/cg-map/services/backend/internal/client/pmtiles"
)

// serveTile writes one vector tile: gzip as stored when accepted, otherwise identity
func (h *handler) serveTile(w http.ResponseWriter, r *http.Request) {
	if !allowRead(w, r) {
		return
	}

	// tiles of other releases are gone: their URLs were cached as immutable
	if r.PathValue("release") != h.release {
		writeError(w, http.StatusNotFound, "unknown release")
		return
	}

	// parse z/x/y; malformed numbers are 400, coordinates outside the archive are 404
	z, x, y, isValidPath := parseTileCoordinates(r.PathValue("z"), r.PathValue("x"), r.PathValue("file"))
	if !isValidPath {
		writeError(w, http.StatusBadRequest, "tile path must be /{z}/{x}/{y}.mvt with non-negative integers without leading zeros")
		return
	}
	if z < h.minZoom || z > h.maxZoom {
		writeError(w, http.StatusNotFound, "zoom outside archive range")
		return
	}
	tileID, err := pmtiles.TileID(z, x, y)
	if err != nil {
		writeError(w, http.StatusNotFound, "tile coordinates outside zoom grid")
		return
	}

	// conditional request: the representation depends on the negotiated encoding
	shouldSendGzip := h.isGzipStored && acceptsGzip(r.Header.Get("Accept-Encoding"))
	etag := h.etag(tileID, shouldSendGzip)
	w.Header().Set("Vary", "Accept-Encoding")
	w.Header().Set("Cache-Control", CacheControlImmutable)
	w.Header().Set("ETag", etag)
	if matchesETag(r.Header.Get("If-None-Match"), etag) {
		w.WriteHeader(http.StatusNotModified)
		return
	}

	// read the tile as stored
	storedTile, isFound, err := h.archive.Tile(z, x, y)
	if err != nil {
		log.Printf("layers: archive.Tile [z=%d, x=%d, y=%d]: %v", z, x, y, err)
		writeError(w, http.StatusInternalServerError, "tile read failed")
		return
	}
	if !isFound {
		// MapLibre renders 204 as an empty tile
		w.WriteHeader(http.StatusNoContent)
		return
	}

	// stream-decode for clients that cannot take gzip
	if h.isGzipStored && !shouldSendGzip {
		h.writeGunzipped(w, r, storedTile, z, x, y)
		return
	}
	writeStoredTile(w, r, storedTile, shouldSendGzip)
}

// writeStoredTile sends the tile bytes unchanged; isGzip declares that they are gzip compressed.
func writeStoredTile(w http.ResponseWriter, r *http.Request, storedTile []byte, isGzip bool) {
	if isGzip {
		w.Header().Set("Content-Encoding", "gzip")
	}
	w.Header().Set("Content-Type", contentTypeMVT)
	w.Header().Set("Content-Length", strconv.Itoa(len(storedTile)))
	w.WriteHeader(http.StatusOK)
	if r.Method != http.MethodHead {
		_, _ = w.Write(storedTile)
	}
}

// writeGunzipped streams a gzip tile decoded, bounded by maxTileDecompressedBytes
func (h *handler) writeGunzipped(w http.ResponseWriter, r *http.Request, gzippedTile []byte, z uint8, x, y uint32) {
	// validate the gzip header and the declared size before committing to 200
	gzipReader, err := gzip.NewReader(bytes.NewReader(gzippedTile))
	if err != nil {
		log.Printf("layers: gzip.NewReader [z=%d, x=%d, y=%d]: %v", z, x, y, err)
		writeError(w, http.StatusInternalServerError, "tile decode failed")
		return
	}
	defer func() { _ = gzipReader.Close() }()
	// a gzip file ends with its decompressed size in 4 little-endian bytes
	const sizeFieldBytes = 4
	declaredBytes := binary.LittleEndian.Uint32(gzippedTile[len(gzippedTile)-sizeFieldBytes:])
	if declaredBytes > maxTileDecompressedBytes {
		log.Printf("layers: tile [z=%d, x=%d, y=%d] declares %d decompressed bytes, limit %d", z, x, y, declaredBytes, maxTileDecompressedBytes)
		writeError(w, http.StatusInternalServerError, "tile decode failed")
		return
	}

	w.Header().Set("Content-Type", contentTypeMVT)
	w.WriteHeader(http.StatusOK)
	if r.Method == http.MethodHead {
		return
	}
	// the status is sent; failures can only be logged
	copiedBytes, err := io.Copy(w, io.LimitReader(gzipReader, maxTileDecompressedBytes))
	if err != nil {
		log.Printf("layers: gunzip stream [z=%d, x=%d, y=%d, copied=%d]: %v", z, x, y, copiedBytes, err)
		return
	}
	// a lying size field or extra gzip members can exceed the limit: the client got a truncated tile
	if copiedBytes == maxTileDecompressedBytes {
		extraBytes, _ := io.ReadFull(gzipReader, make([]byte, 1))
		if extraBytes > 0 {
			log.Printf("layers: gunzip stream [z=%d, x=%d, y=%d]: tile truncated at %d bytes (declared size %d)",
				z, x, y, maxTileDecompressedBytes, declaredBytes)
		}
	}
}

// etag identifies one tile of this release in one encoding.
func (h *handler) etag(tileID uint64, isGzip bool) string {
	encoding := "identity"
	if isGzip {
		encoding = "gzip"
	}
	return fmt.Sprintf(`"%s-%d-%s"`, h.release, tileID, encoding)
}

// parseTileCoordinates parses z, x and "<y>.mvt" in canonical decimal form
func parseTileCoordinates(zText, xText, file string) (z uint8, x, y uint32, isValid bool) {
	const (
		zoomBits       = 8
		coordinateBits = 32
	)
	yText, hasExtension := strings.CutSuffix(file, tileExtension)
	if !hasExtension {
		return 0, 0, 0, false
	}
	zValue, isValidZ := parseCoordinate(zText, zoomBits)
	xValue, isValidX := parseCoordinate(xText, coordinateBits)
	yValue, isValidY := parseCoordinate(yText, coordinateBits)
	if !isValidZ || !isValidX || !isValidY {
		return 0, 0, 0, false
	}
	return uint8(zValue), uint32(xValue), uint32(yValue), true
}

// parseCoordinate accepts only canonical unsigned decimals, so each tile has one URL
func parseCoordinate(text string, bitSize int) (uint64, bool) {
	if len(text) > 1 && text[0] == '0' {
		return 0, false
	}
	value, err := strconv.ParseUint(text, 10, bitSize)
	return value, err == nil
}
