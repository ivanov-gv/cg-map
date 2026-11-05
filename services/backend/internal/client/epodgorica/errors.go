package epodgorica

import "errors"

var (
	// ErrUpstreamStatus is returned for a non-2xx upstream response.
	ErrUpstreamStatus = errors.New("vehicle provider unavailable")
	// ErrUpstreamTooLarge is returned when the upstream body exceeds maxUpstreamBytes.
	ErrUpstreamTooLarge = errors.New("vehicle feed is too large")
	// ErrUpstreamRedirect is returned when the upstream answers with a redirect.
	ErrUpstreamRedirect = errors.New("vehicle provider redirected")
	// ErrUpstreamNotArray is returned when the upstream body is valid JSON but not an array.
	ErrUpstreamNotArray = errors.New("invalid upstream vehicle feed")
)
