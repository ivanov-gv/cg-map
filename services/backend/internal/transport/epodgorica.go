package transport

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
)

// UpstreamURL is the fixed public ePodgorica vehicle endpoint, polled by the source UI at SourceURL.
const UpstreamURL = "https://adminapi.prevoz.podgorica.me/api/dispatcher/vehicles/public"

// maxUpstreamBytes bounds the upstream body, like relay.mjs (512000 characters). Counting bytes is
// at least as strict as counting UTF-16 units.
const maxUpstreamBytes = 512000

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

// EPodgorica reads live positions from the fixed public ePodgorica endpoint.
// It sends no credentials, cookies or caller-supplied headers.
type EPodgorica struct {
	client *http.Client
	url    string
}

// NewEPodgorica returns the live source using a copy of client (nil: a default client) that refuses
// redirects. The feed applies the request timeout through ctx.
func NewEPodgorica(client *http.Client) *EPodgorica {
	configured := &http.Client{}
	if client != nil {
		// a copy: the caller's client keeps its own redirect policy
		*configured = *client
	}
	// the upstream is fixed: never follow it elsewhere
	configured.CheckRedirect = func(*http.Request, []*http.Request) error { return ErrUpstreamRedirect }
	return &EPodgorica{client: configured, url: UpstreamURL}
}

// Vehicles fetches and decodes the upstream rows without filtering; Normalize filters them.
func (s *EPodgorica) Vehicles(ctx context.Context) ([]Vehicle, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, s.url, nil)
	if err != nil {
		return nil, fmt.Errorf("http.NewRequestWithContext: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	response, err := s.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("client.Do: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return nil, fmt.Errorf("EPodgorica.Vehicles [status=%d]: %w", response.StatusCode, ErrUpstreamStatus)
	}

	body, err := io.ReadAll(io.LimitReader(response.Body, maxUpstreamBytes+1))
	if err != nil {
		return nil, fmt.Errorf("io.ReadAll: %w", err)
	}
	if len(body) > maxUpstreamBytes {
		return nil, fmt.Errorf("EPodgorica.Vehicles [limit=%d]: %w", maxUpstreamBytes, ErrUpstreamTooLarge)
	}
	return decodeVehicles(body)
}

// decodeVehicles maps upstream rows the way relay.mjs reads them: routeName must be a JSON string
// and coordinates must be JSON numbers; anything else becomes "" or NaN for Normalize to discard.
func decodeVehicles(body []byte) ([]Vehicle, error) {
	var rows []json.RawMessage
	err := json.Unmarshal(body, &rows)
	if err != nil {
		var typeErr *json.UnmarshalTypeError
		if errors.As(err, &typeErr) {
			return nil, fmt.Errorf("decodeVehicles: %w", ErrUpstreamNotArray)
		}
		return nil, fmt.Errorf("json.Unmarshal: %w", err)
	}
	if rows == nil {
		// JSON null is not an array
		return nil, fmt.Errorf("decodeVehicles: %w", ErrUpstreamNotArray)
	}
	if len(rows) > maxVehicleRows {
		return nil, fmt.Errorf("decodeVehicles [rows=%d]: %w", len(rows), ErrTooManyVehicles)
	}

	vehicles := make([]Vehicle, 0, len(rows))
	for _, raw := range rows {
		var fields map[string]json.RawMessage
		if bytes.HasPrefix(bytes.TrimSpace(raw), []byte("{")) {
			// an object always decodes; other row types keep fields nil and are discarded later
			_ = json.Unmarshal(raw, &fields)
		}
		vehicles = append(vehicles, Vehicle{
			Route:     jsonString(fields["routeName"]),
			Longitude: jsonNumber(fields["longitude"]),
			Latitude:  jsonNumber(fields["latitude"]),
		})
	}
	return vehicles, nil
}

func jsonString(raw json.RawMessage) string {
	var value string
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	return value
}

func jsonNumber(raw json.RawMessage) float64 {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || (trimmed[0] != '-' && (trimmed[0] < '0' || trimmed[0] > '9')) {
		return math.NaN()
	}
	var value float64
	if json.Unmarshal(trimmed, &value) != nil {
		return math.NaN()
	}
	return value
}
