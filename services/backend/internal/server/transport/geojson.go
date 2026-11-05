package transport

// FeatureCollection is the GeoJSON feed body (packages/contracts/vehicles.schema.json v1).
// Field order matches relay.mjs output.
type FeatureCollection struct {
	Type     string    `json:"type"`
	Features []Feature `json:"features"`
	// FetchedAt is the server's check time (not a GPS time); nil encodes as null in the 503 body.
	FetchedAt *string `json:"fetchedAt"`
	Source    string  `json:"source"`
	Stale     bool    `json:"stale"`
	// Error is present only in the 503 unavailable body.
	Error string `json:"error,omitempty"`
}

// Feature is one vehicle position.
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

// FeatureProperties carries the route and, once the vehicle has moved between checks, its derived direction.
type FeatureProperties struct {
	Route string `json:"route"`
	// Bearing is degrees clockwise from north, derived from movement (the upstream has no heading).
	Bearing *float64 `json:"bearing,omitempty"`
	// Heading is headingMovement when Bearing is set.
	Heading string `json:"heading,omitempty"`
}

// unavailableCollection is the 503 body: no positions, no check time.
func unavailableCollection() FeatureCollection {
	return FeatureCollection{
		Type:     featureCollectionType,
		Features: []Feature{},
		Source:   sourceURL,
		Stale:    true,
		Error:    unavailableMessage,
	}
}
