package transport

import "time"

const (
	// VehiclesPath is the public read-only vehicle feed route.
	VehiclesPath = "/api/v1/transport/vehicles"
	// SourceURL is the attribution published in every feed (contract const).
	SourceURL = "https://epodgorica.me/javniprevoz/mapa"
)

// normalization limits, identical to services/transit-relay/relay.mjs
const (
	maxVehicleRows = 2000
	maxRouteLength = 32 // UTF-16 code units, like JS String.prototype.slice
	minLongitude   = 17.8
	maxLongitude   = 21.0
	minLatitude    = 41.3
	maxLatitude    = 44.1
)

// cache timings, identical to services/transit-relay/relay.mjs
const (
	cacheTTL              = 13 * time.Second
	maxStaleAge           = 60 * time.Second
	defaultRefreshTimeout = 8 * time.Second
	// pollInterval is how often Poll checks the cache; a refresh follows within a second of expiry
	pollInterval = time.Second
	// failureLogInterval rate-limits upstream failure logs
	failureLogInterval = time.Minute
)

// wire values
const (
	featureCollectionType = "FeatureCollection"
	featureType           = "Feature"
	pointType             = "Point"
	// fetchedAtLayout matches JS Date.prototype.toISOString for UTC times.
	fetchedAtLayout    = "2006-01-02T15:04:05.000Z"
	unavailableMessage = "Live bus positions are temporarily unavailable"
	methodNotAllowed   = "Method not allowed"
)

// response headers, identical to services/transit-relay/relay.mjs
const (
	allowedMethods     = "GET, OPTIONS"
	jsonContentType    = "application/json; charset=utf-8"
	publicCacheControl = "public, max-age=5, s-maxage=10"
	noStoreControl     = "no-store"
)
