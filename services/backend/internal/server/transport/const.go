package transport

const (
	// VehiclesPath is the public read-only GeoJSON vehicle feed route.
	VehiclesPath = "/api/v1/transport/vehicles"
	// sourceURL is the attribution published in every response (contract const).
	sourceURL = "https://epodgorica.me/javniprevoz/mapa"
)

// wire values, identical to services/transit-relay/relay.mjs
const (
	featureCollectionType = "FeatureCollection"
	featureType           = "Feature"
	pointType             = "Point"
	// headingMovement marks a bearing derived from the vehicle's movement between feed checks.
	headingMovement = "movement"
	// fetchedAtLayout matches JS Date.prototype.toISOString for UTC times.
	fetchedAtLayout         = "2006-01-02T15:04:05.000Z"
	unavailableMessage      = "Live bus positions are temporarily unavailable"
	methodNotAllowedMessage = "Method not allowed"
)

// response headers, identical to services/transit-relay/relay.mjs
const (
	allowedMethods      = "GET, OPTIONS"
	jsonContentType     = "application/json; charset=utf-8"
	publicCacheControl  = "public, max-age=5, s-maxage=10"
	noStoreCacheControl = "no-store"
)
