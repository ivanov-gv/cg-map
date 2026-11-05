package vehicles

import "time"

// MaxVehicleRows bounds the feed to the contract's size, identical to services/transit-relay/relay.mjs.
const MaxVehicleRows = 2000

// normalization limits, identical to services/transit-relay/relay.mjs
const (
	maxRouteUTF16Units = 32 // like JS String.prototype.slice
	minLongitude       = 17.8
	maxLongitude       = 21.0
	minLatitude        = 41.3
	maxLatitude        = 44.1
)

// cache timings, identical to services/transit-relay/relay.mjs; only Feed also waits cacheTTL after a failure
const (
	cacheTTL              = 13 * time.Second
	maxStaleAge           = 60 * time.Second
	defaultRefreshTimeout = 8 * time.Second
	// failureLogInterval rate-limits upstream failure logs
	failureLogInterval = time.Minute
)

// DefaultPollInterval is how often an Observer checks the cache; a refresh follows within a second of expiry.
const DefaultPollInterval = time.Second
