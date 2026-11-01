// Package transport serves the public live vehicle feed (packages/contracts/vehicles.schema.json v1).
//
// It reproduces services/transit-relay/relay.mjs: normalization, a short shared cache with
// single-flight refreshes, explicit stale/expiry responses, and identical headers. The upstream
// is pluggable through Source: EPodgorica reads the live feed, Unavailable always fails.
package transport

import (
	"context"
	"fmt"
)

// Vehicle is one raw upstream row before normalization.
//
// Sources map upstream fields directly and do not filter: a missing or non-string route becomes
// "", and a missing or non-numeric coordinate becomes math.NaN(). Normalize discards such rows,
// as relay.mjs does.
type Vehicle struct {
	Route     string
	Longitude float64
	Latitude  float64
}

// Source supplies raw vehicle rows from the fixed upstream.
//
// Implementations must honor ctx cancellation, must not accept caller-supplied URLs, and must
// bound the upstream body size (relay.mjs rejects bodies over 512000 characters).
type Source interface {
	Vehicles(ctx context.Context) ([]Vehicle, error)
}

// Unavailable is a Source for running without the live upstream (the -live-transport=false flag).
type Unavailable struct{}

// Vehicles always fails with ErrSourceNotConfigured.
func (Unavailable) Vehicles(context.Context) ([]Vehicle, error) {
	return nil, fmt.Errorf("Unavailable.Vehicles: %w", ErrSourceNotConfigured)
}
