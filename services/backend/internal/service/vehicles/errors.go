package vehicles

import "errors"

var (
	// ErrSourceNotConfigured is returned by Unavailable when the live source is disabled.
	ErrSourceNotConfigured = errors.New("live vehicle source is not configured")
	// ErrTooManyVehicles rejects an upstream feed above the contract's 2000 features.
	ErrTooManyVehicles = errors.New("upstream vehicle feed has too many rows")
	// ErrNoValidVehicles rejects a non-empty upstream feed without one usable position.
	ErrNoValidVehicles = errors.New("upstream returned no valid vehicle positions")
	// ErrSourceBusy means an abandoned (timed-out) source call has not returned yet.
	ErrSourceBusy = errors.New("previous source call has not returned")
	// ErrRefreshBackingOff means the last refresh failed less than a cache period ago, so no new one starts.
	ErrRefreshBackingOff = errors.New("last refresh failed recently")
	// ErrUnavailable means neither a fresh nor an acceptably stale snapshot exists.
	ErrUnavailable = errors.New("live vehicle positions are unavailable")
)
