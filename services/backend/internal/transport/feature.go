package transport

import "time"

// FeatureCollection is the published feed body. Field order matches relay.mjs output.
type FeatureCollection struct {
	Type     string    `json:"type"`
	Features []Feature `json:"features"`
	// FetchedAt is the relay check time (not a GPS time); nil encodes as null in the 503 body.
	FetchedAt *string `json:"fetchedAt"`
	Source    string  `json:"source"`
	Stale     bool    `json:"stale"`
	// Error is present only in the 503 unavailable body.
	Error string `json:"error,omitempty"`
}

// Feature is one deduplicated vehicle position.
type Feature struct {
	Type       string            `json:"type"`
	Geometry   Point             `json:"geometry"`
	Properties FeatureProperties `json:"properties"`
}

// Point is a GeoJSON point in [longitude, latitude] order.
type Point struct {
	Type        string     `json:"type"`
	Coordinates [2]float64 `json:"coordinates"`
}

// FeatureProperties carries the route and, once the bus has moved between checks, its derived direction.
type FeatureProperties struct {
	Route string `json:"route"`
	// Bearing is degrees clockwise from north, derived from movement (the upstream has no heading).
	Bearing *float64 `json:"bearing,omitempty"`
	// Heading is HeadingMovement when Bearing is set.
	Heading string `json:"heading,omitempty"`
}

// snapshot is the last successfully normalized feed.
type snapshot struct {
	features  []Feature
	fetchedAt time.Time // UTC, truncated to milliseconds like a JS Date
}

// collection renders the snapshot as a feed body, optionally marked stale.
func (s *snapshot) collection(stale bool) FeatureCollection {
	fetchedAt := formatFetchedAt(s.fetchedAt)
	return FeatureCollection{
		Type:      featureCollectionType,
		Features:  s.features,
		FetchedAt: &fetchedAt,
		Source:    SourceURL,
		Stale:     stale,
	}
}

// unavailableCollection is the 503 body: no positions, no check time.
func unavailableCollection() FeatureCollection {
	return FeatureCollection{
		Type:     featureCollectionType,
		Features: []Feature{},
		Source:   SourceURL,
		Stale:    true,
		Error:    unavailableMessage,
	}
}

// formatFetchedAt formats like JS toISOString: UTC with exactly three fractional digits.
func formatFetchedAt(moment time.Time) string {
	return moment.UTC().Format(fetchedAtLayout)
}
