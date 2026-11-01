package pmtiles

import "fmt"

// ZxyToID converts tile coordinates to a PMTiles tile ID:
// the count of all tiles on lower zooms plus the Hilbert curve index of (x, y) on zoom z
func ZxyToID(z uint8, x, y uint32) (uint64, error) {
	// validate coordinates against the zoom grid
	if z > MaxZoom {
		return 0, fmt.Errorf("ZxyToID [z=%d]: %w", z, ErrInvalidTileCoordinates)
	}
	side := uint64(1) << z
	if uint64(x) >= side || uint64(y) >= side {
		return 0, fmt.Errorf("ZxyToID [z=%d, x=%d, y=%d]: %w", z, x, y, ErrInvalidTileCoordinates)
	}

	// tiles on zooms 0..z-1: (4^z - 1) / 3
	base := (side*side - 1) / 3

	// Hilbert index, rotating the quadrant at every level
	tx, ty := uint64(x), uint64(y)
	var hilbert uint64
	for s := side / 2; s > 0; s /= 2 {
		var rx, ry uint64
		if tx&s > 0 {
			rx = 1
		}
		if ty&s > 0 {
			ry = 1
		}
		hilbert += s * s * ((3 * rx) ^ ry)
		// keep only the bits below s, then rotate within the s*s quadrant
		tx, ty = tx&(s-1), ty&(s-1)
		if ry == 0 {
			if rx == 1 {
				tx, ty = s-1-tx, s-1-ty
			}
			tx, ty = ty, tx
		}
	}
	return base + hilbert, nil
}
