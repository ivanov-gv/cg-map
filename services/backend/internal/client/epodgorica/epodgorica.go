// Package epodgorica reads live bus positions from the public ePodgorica endpoint.
package epodgorica

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"

	"github.com/ivanov-gv/cg-map/services/backend/internal/service/vehicles"
)

// Client reads live positions from the fixed public endpoint. It implements vehicles.Source and
// sends no credentials, cookies or caller-supplied headers.
type Client struct {
	httpClient *http.Client
	url        string
}

// NewClient returns the live source using a copy of httpClient (nil: a default client) that refuses
// redirects. The feed applies the request timeout through ctx.
func NewClient(httpClient *http.Client) *Client {
	noRedirectClient := &http.Client{}
	if httpClient != nil {
		// a copy: the caller's client keeps its own redirect policy
		*noRedirectClient = *httpClient
	}
	// the upstream is fixed: never follow it elsewhere
	noRedirectClient.CheckRedirect = func(*http.Request, []*http.Request) error { return ErrUpstreamRedirect }
	return &Client{httpClient: noRedirectClient, url: upstreamURL}
}

// Vehicles fetches and decodes the upstream rows without filtering; the feed filters them.
func (c *Client) Vehicles(ctx context.Context) ([]vehicles.UpstreamVehicle, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, c.url, nil)
	if err != nil {
		return nil, fmt.Errorf("http.NewRequestWithContext: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	response, err := c.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("httpClient.Do: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < http.StatusOK || response.StatusCode >= http.StatusMultipleChoices {
		return nil, fmt.Errorf("Client.Vehicles [status=%d]: %w", response.StatusCode, ErrUpstreamStatus)
	}

	// read one byte past the limit to tell "exactly at the limit" from "too large"
	body, err := io.ReadAll(io.LimitReader(response.Body, maxUpstreamBytes+1))
	if err != nil {
		return nil, fmt.Errorf("io.ReadAll: %w", err)
	}
	if len(body) > maxUpstreamBytes {
		return nil, fmt.Errorf("Client.Vehicles [limit=%d]: %w", maxUpstreamBytes, ErrUpstreamTooLarge)
	}
	return decodeVehicles(body)
}

// decodeVehicles maps upstream rows the way relay.mjs reads them: routeName must be a JSON string
// and coordinates must be JSON numbers; anything else becomes "" or NaN for the feed to discard.
func decodeVehicles(body []byte) ([]vehicles.UpstreamVehicle, error) {
	var rawRows []json.RawMessage
	err := json.Unmarshal(body, &rawRows)
	if err != nil {
		var typeErr *json.UnmarshalTypeError
		if errors.As(err, &typeErr) {
			return nil, fmt.Errorf("decodeVehicles: %w", ErrUpstreamNotArray)
		}
		return nil, fmt.Errorf("json.Unmarshal: %w", err)
	}
	if rawRows == nil {
		// JSON null is not an array
		return nil, fmt.Errorf("decodeVehicles: %w", ErrUpstreamNotArray)
	}
	if len(rawRows) > vehicles.MaxVehicleRows {
		return nil, fmt.Errorf("decodeVehicles [rows=%d]: %w", len(rawRows), vehicles.ErrTooManyVehicles)
	}

	rows := make([]vehicles.UpstreamVehicle, 0, len(rawRows))
	for _, rawRow := range rawRows {
		var fields map[string]json.RawMessage
		if bytes.HasPrefix(bytes.TrimSpace(rawRow), []byte("{")) {
			// an object always decodes; other row types keep fields nil and are discarded later
			_ = json.Unmarshal(rawRow, &fields)
		}
		rows = append(rows, vehicles.UpstreamVehicle{
			Route:     stringOrEmpty(fields["routeName"]),
			Longitude: numberOrNaN(fields["longitude"]),
			Latitude:  numberOrNaN(fields["latitude"]),
		})
	}
	return rows, nil
}

// stringOrEmpty returns a JSON string's value, or "" for any other JSON value.
func stringOrEmpty(raw json.RawMessage) string {
	var value string
	if json.Unmarshal(raw, &value) != nil {
		return ""
	}
	return value
}

// numberOrNaN returns a JSON number's value, or NaN for any other JSON value.
func numberOrNaN(raw json.RawMessage) float64 {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return math.NaN()
	}
	// json.Unmarshal into a float also accepts null, so check the first character
	firstCharacter := trimmed[0]
	startsLikeNumber := firstCharacter == '-' || (firstCharacter >= '0' && firstCharacter <= '9')
	if !startsLikeNumber {
		return math.NaN()
	}
	var value float64
	if json.Unmarshal(trimmed, &value) != nil {
		return math.NaN()
	}
	return value
}
