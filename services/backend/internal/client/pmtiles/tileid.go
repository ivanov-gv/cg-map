package pmtiles

import "fmt"

// TileID converts tile coordinates to a PMTiles tile ID:
// the count of all tiles on lower zooms plus the Hilbert curve index of (x, y) on zoom z
//
//nolint:mnd // constants of the tile count formula and the Hilbert curve
func TileID(z uint8, x, y uint32) (uint64, error) {
	// validate coordinates against the zoom grid
	if z > MaxZoom {
		return 0, fmt.Errorf("TileID [z=%d]: %w", z, ErrInvalidTileCoordinates)
	}
	tilesPerSide := uint64(1) << z
	if uint64(x) >= tilesPerSide || uint64(y) >= tilesPerSide {
		return 0, fmt.Errorf("TileID [z=%d, x=%d, y=%d]: %w", z, x, y, ErrInvalidTileCoordinates)
	}

	// tiles on zooms 0..z-1: (4^z - 1) / 3
	tilesOnLowerZooms := (tilesPerSide*tilesPerSide - 1) / 3

	// Hilbert index, rotating the quadrant at every level
	remainingX, remainingY := uint64(x), uint64(y)
	var hilbertIndex uint64
	for quadrantSide := tilesPerSide / 2; quadrantSide > 0; quadrantSide /= 2 {
		var xBit, yBit uint64
		if remainingX&quadrantSide > 0 {
			xBit = 1
		}
		if remainingY&quadrantSide > 0 {
			yBit = 1
		}
		hilbertIndex += quadrantSide * quadrantSide * ((3 * xBit) ^ yBit)
		// keep only the bits below quadrantSide, then rotate within the quadrant
		remainingX, remainingY = remainingX&(quadrantSide-1), remainingY&(quadrantSide-1)
		if yBit == 0 {
			if xBit == 1 {
				remainingX, remainingY = quadrantSide-1-remainingX, quadrantSide-1-remainingY
			}
			remainingX, remainingY = remainingY, remainingX
		}
	}
	return tilesOnLowerZooms + hilbertIndex, nil
}
