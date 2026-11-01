package layers

import (
	"fmt"
	"net/url"
	"strings"
)

// Option configures NewHandler
type Option func(*options)

type options struct {
	publicURL string
}

// WithPublicURL makes TileJSON tile URLs start with baseURL (e.g. "https://maps.example" or
// "https://example.org/kompas") instead of the request's scheme and Host header
func WithPublicURL(baseURL string) Option {
	return func(o *options) {
		o.publicURL = baseURL
	}
}

// normalizePublicURL validates an absolute http(s) base URL and drops a trailing slash; empty stays empty
func normalizePublicURL(baseURL string) (string, error) {
	if baseURL == "" {
		return "", nil
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return "", fmt.Errorf("url.Parse: %w: %w", ErrInvalidPublicURL, err)
	}
	if (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" ||
		parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", ErrInvalidPublicURL
	}
	return strings.TrimSuffix(parsed.String(), "/"), nil
}
