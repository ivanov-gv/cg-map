package vehicles

import (
	"fmt"
	"math"
	"strings"
	"unicode"
)

// normalize converts raw upstream rows into vehicles, mirroring relay.mjs normalizeVehicles:
// routes are JS-trimmed and cut to 32 UTF-16 code units, rows with an empty route or an invalid or
// out-of-region coordinate are skipped, and identical route+position rows are merged.
func normalize(rows []UpstreamVehicle) ([]Vehicle, error) {
	// bound the feed to the contract size
	if len(rows) > MaxVehicleRows {
		return nil, fmt.Errorf("normalize [rows=%d]: %w", len(rows), ErrTooManyVehicles)
	}

	type routePosition struct {
		route               string
		longitude, latitude float64
	}
	seenPositions := make(map[routePosition]struct{}, len(rows))
	vehicles := make([]Vehicle, 0, len(rows))
	for _, row := range rows {
		route := truncateUTF16(strings.TrimFunc(row.Route, isJSWhitespace), maxRouteUTF16Units)
		// skip unusable rows
		if route == "" || !inRegion(row.Longitude, row.Latitude) {
			continue
		}
		// merge provider duplicates
		routeAndPosition := routePosition{route: route, longitude: row.Longitude, latitude: row.Latitude}
		if _, isDuplicate := seenPositions[routeAndPosition]; isDuplicate {
			continue
		}
		seenPositions[routeAndPosition] = struct{}{}
		vehicles = append(vehicles, Vehicle{Route: route, Longitude: row.Longitude, Latitude: row.Latitude})
	}

	// a non-empty feed without one usable row is a provider failure, not "no vehicles"
	if len(rows) > 0 && len(vehicles) == 0 {
		return nil, fmt.Errorf("normalize [rows=%d]: %w", len(rows), ErrNoValidVehicles)
	}
	return vehicles, nil
}

// inRegion reports whether a finite coordinate lies inside the contract's Montenegro bounds.
func inRegion(longitude, latitude float64) bool {
	if math.IsNaN(longitude) || math.IsInf(longitude, 0) || math.IsNaN(latitude) || math.IsInf(latitude, 0) {
		return false
	}
	return longitude >= minLongitude && longitude <= maxLongitude && latitude >= minLatitude && latitude <= maxLatitude
}

// isJSWhitespace matches the characters removed by JS String.prototype.trim:
// WhiteSpace (incl. U+FEFF and category Zs) and LineTerminator. Unlike unicode.IsSpace it keeps U+0085.
func isJSWhitespace(character rune) bool {
	switch character {
	case '\t', '\n', '\v', '\f', '\r', '\u00a0', '\ufeff', '\u2028', '\u2029':
		return true
	}
	return unicode.Is(unicode.Zs, character)
}

// truncateUTF16 keeps the longest prefix of at most limit UTF-16 code units, like JS slice(0, limit).
// Where JS would split a surrogate pair and keep a lone high surrogate, which valid UTF-8 cannot
// hold, the whole character is dropped instead. Invalid UTF-8 bytes count as one unit each
// (they are encoded as U+FFFD).
func truncateUTF16(text string, limit int) string {
	const maxBasicPlaneCharacter = 0xFFFF
	usedUnits := 0
	for byteIndex, character := range text {
		// characters above the Basic Multilingual Plane take a surrogate pair
		characterUnits := 1
		if character > maxBasicPlaneCharacter {
			characterUnits = 2
		}
		if usedUnits+characterUnits > limit {
			return text[:byteIndex]
		}
		usedUnits += characterUnits
	}
	return text
}
