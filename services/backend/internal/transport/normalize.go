package transport

import (
	"fmt"
	"math"
	"strings"
	"unicode"
)

// Normalize converts raw upstream rows into contract features, mirroring relay.mjs normalizeVehicles:
// routes are JS-trimmed and cut to 32 UTF-16 code units, rows with an empty route or an invalid or
// out-of-region coordinate are skipped, and identical route+position rows are merged.
func Normalize(rows []Vehicle) ([]Feature, error) {
	// bound the feed to the contract size
	if len(rows) > maxVehicleRows {
		return nil, fmt.Errorf("Normalize [rows=%d]: %w", len(rows), ErrTooManyVehicles)
	}

	type positionKey struct {
		route               string
		longitude, latitude float64
	}
	seen := make(map[positionKey]struct{}, len(rows))
	features := make([]Feature, 0, len(rows))
	for _, row := range rows {
		route := truncateUTF16(strings.TrimFunc(row.Route, isJSWhitespace), maxRouteLength)
		// skip unusable rows
		if route == "" || !inRegion(row.Longitude, row.Latitude) {
			continue
		}
		// merge provider duplicates
		key := positionKey{route: route, longitude: row.Longitude, latitude: row.Latitude}
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		features = append(features, Feature{
			Type:       featureType,
			Geometry:   Point{Type: pointType, Coordinates: [2]float64{row.Longitude, row.Latitude}},
			Properties: FeatureProperties{Route: route},
		})
	}

	// a non-empty feed without one usable row is a provider failure, not "no buses"
	if len(rows) > 0 && len(features) == 0 {
		return nil, fmt.Errorf("Normalize [rows=%d]: %w", len(rows), ErrNoValidVehicles)
	}
	return features, nil
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
func isJSWhitespace(char rune) bool {
	switch char {
	case '\t', '\n', '\v', '\f', '\r', '\u00a0', '\ufeff', '\u2028', '\u2029':
		return true
	}
	return unicode.Is(unicode.Zs, char)
}

// truncateUTF16 keeps the longest prefix of at most limit UTF-16 code units, like JS slice(0, limit).
// Where JS would split a surrogate pair and keep a lone high surrogate, which valid UTF-8 cannot
// hold, the whole character is dropped instead. Invalid UTF-8 bytes count as one unit each
// (they are encoded as U+FFFD).
func truncateUTF16(text string, limit int) string {
	units := 0
	for index, char := range text {
		width := 1
		if char > 0xFFFF {
			width = 2
		}
		if units+width > limit {
			return text[:index]
		}
		units += width
	}
	return text
}
