// Package vehicles keeps the current live vehicle positions: it reads a Source, normalizes the rows,
// derives each vehicle's direction from its movement and caches the result. It knows nothing about
// HTTP, GeoJSON or protobuf; internal/server/transport publishes its snapshots.
package vehicles

import (
	"context"
	"fmt"
	"time"
)

// Vehicle is one position from a feed check: deduplicated, and with a direction once its movement is known.
type Vehicle struct {
	Route     string
	Longitude float64
	Latitude  float64
	// DirectionDegrees is clockwise from north, derived from movement (the upstream reports no direction).
	// It is nil while unknown, because 0 means north.
	DirectionDegrees *float64
}

// coordinates is a position in degrees.
type coordinates struct {
	longitude, latitude float64
}

// position returns where the vehicle is.
func (v Vehicle) position() coordinates {
	return coordinates{longitude: v.Longitude, latitude: v.Latitude}
}

// Snapshot is one successful check of the upstream. Vehicles and their DirectionDegrees are
// shared between callers, so treat them as read-only.
type Snapshot struct {
	Vehicles []Vehicle
	// FetchedAt is the server's check time (not a GPS time): UTC, truncated to milliseconds.
	FetchedAt time.Time
	// Stale marks a previous snapshot served because the latest refresh failed.
	Stale bool
}

// UpstreamVehicle is one raw upstream row before normalization.
//
// Sources map upstream fields directly and do not filter: a missing or non-string route becomes
// "", and a missing or non-numeric coordinate becomes math.NaN(). normalize discards such rows,
// as relay.mjs does.
type UpstreamVehicle struct {
	Route     string
	Longitude float64
	Latitude  float64
}

// Source supplies raw vehicle rows from the fixed upstream.
//
// Implementations must honor ctx cancellation, must not accept caller-supplied URLs, and must
// bound the upstream body size (relay.mjs rejects bodies over 512000 characters).
type Source interface {
	Vehicles(ctx context.Context) ([]UpstreamVehicle, error)
}

// Unavailable is a Source for running without the live upstream (the -live-transport=false flag).
type Unavailable struct{}

// Vehicles always fails with ErrSourceNotConfigured.
func (Unavailable) Vehicles(context.Context) ([]UpstreamVehicle, error) {
	return nil, fmt.Errorf("Unavailable.Vehicles: %w", ErrSourceNotConfigured)
}
