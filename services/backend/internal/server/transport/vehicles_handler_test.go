package transport

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/ivanov-gv/cg-map/services/backend/internal/service/vehicles"
)

// cacheTTL is the feed's fresh window, as these tests observe it from outside the package.
const cacheTTL = 13 * time.Second

// limits from packages/contracts/vehicles.schema.json
const (
	contractMaxFeatures        = 2000
	contractMaxRouteCharacters = 32
	contractMinLongitude       = 17.8
	contractMaxLongitude       = 21.0
	contractMinLatitude        = 41.3
	contractMaxLatitude        = 44.1
	contractBearingLimit       = 360
)

var (
	errOffline = errors.New("offline")
	startTime  = time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
	sampleRow  = vehicles.UpstreamVehicle{Route: "6A", Longitude: 19.26, Latitude: 42.44}
)

// fakeClock is a manually advanced clock.
type fakeClock struct {
	mutex   sync.Mutex
	current time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	return c.current
}

func (c *fakeClock) Set(offset time.Duration) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	c.current = startTime.Add(offset)
}

// fakeSource returns [sampleRow] or errOffline and counts calls.
type fakeSource struct {
	mutex sync.Mutex
	calls int
	fail  bool
}

func (s *fakeSource) Vehicles(context.Context) ([]vehicles.UpstreamVehicle, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.calls++
	if s.fail {
		return nil, errOffline
	}
	return []vehicles.UpstreamVehicle{sampleRow}, nil
}

func (s *fakeSource) SetFail(fail bool) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.fail = fail
}

func (s *fakeSource) Calls() int {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.calls
}

// emptySource reports a valid feed with no vehicles.
type emptySource struct{}

func (emptySource) Vehicles(context.Context) ([]vehicles.UpstreamVehicle, error) {
	return []vehicles.UpstreamVehicle{}, nil
}

// movingSource reports one vehicle that moves 0.001° north on every call.
type movingSource struct {
	mutex sync.Mutex
	calls int
}

func (s *movingSource) Vehicles(context.Context) ([]vehicles.UpstreamVehicle, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.calls++
	return []vehicles.UpstreamVehicle{{Route: "6A", Longitude: 19.26, Latitude: 42.44 + 0.001*float64(s.calls)}}, nil
}

func (s *movingSource) Calls() int {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.calls
}

// waitFor polls condition and fails the test if it does not hold within 5s.
func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !condition() {
		if time.Now().After(deadline) {
			t.Fatal("condition not reached within 5s")
		}
		time.Sleep(time.Millisecond)
	}
}

func newTestFeed(source vehicles.Source) (*vehicles.Feed, *fakeClock) {
	clock := &fakeClock{current: startTime}
	return vehicles.NewFeed(source, clock.Now), clock
}

func get(handler http.Handler, method string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(method, VehiclesPath, nil))
	return recorder
}

// cacheStep is one request in a TestHandlerCache scenario, at an offset from startTime.
type cacheStep struct {
	at               time.Duration
	fail             bool
	wantStatus       int
	wantStale        bool
	wantVehicles     int
	wantFetchedAt    string // "" means null
	wantCalls        int
	wantCacheControl string
}

// assertCacheStep checks one step's response and the source calls made so far.
func assertCacheStep(t *testing.T, index int, currentStep cacheStep, response *httptest.ResponseRecorder, source *fakeSource) {
	t.Helper()
	if response.Code != currentStep.wantStatus {
		t.Fatalf("step %d: status = %d, want %d", index, response.Code, currentStep.wantStatus)
	}
	assertCommonHeaders(t, response, currentStep.wantCacheControl)
	body := decodeFeed(t, response.Body.Bytes())
	if body.Stale != currentStep.wantStale || len(body.Features) != currentStep.wantVehicles {
		t.Errorf("step %d: stale=%v vehicles=%d, want %v/%d", index, body.Stale, len(body.Features), currentStep.wantStale, currentStep.wantVehicles)
	}
	gotFetchedAt := ""
	if body.FetchedAt != nil {
		gotFetchedAt = *body.FetchedAt
	}
	if gotFetchedAt != currentStep.wantFetchedAt {
		t.Errorf("step %d: fetchedAt = %q, want %q", index, gotFetchedAt, currentStep.wantFetchedAt)
	}
	if got := source.Calls(); got != currentStep.wantCalls {
		t.Errorf("step %d: source calls = %d, want %d", index, got, currentStep.wantCalls)
	}
	if response.Code == http.StatusOK {
		validateContract(t, response.Body.Bytes())
	}
}

func TestHandlerCache(t *testing.T) { //nolint:funlen // mostly a table of cases
	const (
		public         = "public, max-age=5, s-maxage=10"
		noStore        = "no-store"
		firstFetchedAt = "2026-11-01T12:00:00.000Z"
	)
	freshStep := func(at time.Duration, fetchedAt string, calls int) cacheStep {
		return cacheStep{at: at, wantStatus: 200, wantVehicles: 1, wantFetchedAt: fetchedAt, wantCalls: calls, wantCacheControl: public}
	}
	stale := func(at time.Duration, calls int) cacheStep {
		return cacheStep{at: at, fail: true, wantStatus: 200, wantStale: true, wantVehicles: 1, wantFetchedAt: firstFetchedAt, wantCalls: calls, wantCacheControl: noStore}
	}
	unavailable := func(at time.Duration, calls int) cacheStep {
		return cacheStep{at: at, fail: true, wantStatus: 503, wantStale: true, wantCalls: calls, wantCacheControl: noStore}
	}

	tests := []struct {
		name  string
		steps []cacheStep
	}{
		{
			name: "fresh cache served without calling the source",
			steps: []cacheStep{
				freshStep(0, firstFetchedAt, 1),
				{at: 12999 * time.Millisecond, fail: true, wantStatus: 200, wantVehicles: 1, wantFetchedAt: firstFetchedAt, wantCalls: 1, wantCacheControl: public},
			},
		},
		{
			name:  "refresh after TTL succeeds",
			steps: []cacheStep{freshStep(0, firstFetchedAt, 1), freshStep(13*time.Second, "2026-11-01T12:00:13.000Z", 2)},
		},
		{
			name:  "failure within 60s serves stale snapshot",
			steps: []cacheStep{freshStep(0, firstFetchedAt, 1), stale(14*time.Second, 2), stale(60*time.Second, 3)},
		},
		{
			name:  "failure after 60s is unavailable",
			steps: []cacheStep{freshStep(0, firstFetchedAt, 1), unavailable(60*time.Second+time.Millisecond, 2)},
		},
		{
			// port of relay.test.mjs outage test, except that a retry waits a cache period after a failure
			name: "outage is stale, then expires, then recovers",
			steps: []cacheStep{
				freshStep(0, firstFetchedAt, 1),
				stale(14*time.Second, 2),
				unavailable(61*time.Second, 3),
				freshStep(74*time.Second, "2026-11-01T12:01:14.000Z", 4),
			},
		},
		{
			name:  "first refresh failure is unavailable",
			steps: []cacheStep{unavailable(0, 1)},
		},
		{
			name:  "fetchedAt has millisecond precision",
			steps: []cacheStep{freshStep(1234567*time.Microsecond, "2026-11-01T12:00:01.234Z", 1)},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			source := &fakeSource{}
			vehicleFeed, clock := newTestFeed(source)
			handler := NewVehiclesHandler(vehicleFeed)
			for index, currentStep := range test.steps {
				clock.Set(currentStep.at)
				source.SetFail(currentStep.fail)
				response := get(handler, http.MethodGet)
				assertCacheStep(t, index, currentStep, response, source)
			}
		})
	}
}

func TestHandlerBodies(t *testing.T) {
	tests := []struct {
		name       string
		source     vehicles.Source
		wantStatus int
		wantBody   string
	}{
		{
			name:       "success body matches relay serialization",
			source:     &fakeSource{},
			wantStatus: 200,
			wantBody:   `{"type":"FeatureCollection","features":[{"type":"Feature","geometry":{"type":"Point","coordinates":[19.26,42.44]},"properties":{"route":"6A"}}],"fetchedAt":"2026-11-01T12:00:00.000Z","source":"https://epodgorica.me/javniprevoz/mapa","stale":false}`,
		},
		{
			name:       "empty feed encodes an empty array",
			source:     emptySource{},
			wantStatus: 200,
			wantBody:   `{"type":"FeatureCollection","features":[],"fetchedAt":"2026-11-01T12:00:00.000Z","source":"https://epodgorica.me/javniprevoz/mapa","stale":false}`,
		},
		{
			name:       "default unavailable source answers 503",
			source:     vehicles.Unavailable{},
			wantStatus: 503,
			wantBody:   `{"type":"FeatureCollection","features":[],"fetchedAt":null,"source":"https://epodgorica.me/javniprevoz/mapa","stale":true,"error":"Live bus positions are temporarily unavailable"}`,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			vehicleFeed, _ := newTestFeed(test.source)
			response := get(NewVehiclesHandler(vehicleFeed), http.MethodGet)
			if response.Code != test.wantStatus || response.Body.String() != test.wantBody {
				t.Errorf("response = %d %s\nwant %d %s", response.Code, response.Body.String(), test.wantStatus, test.wantBody)
			}
		})
	}
}

func TestHandlerMethods(t *testing.T) {
	tests := []struct {
		method     string
		wantStatus int
		wantBody   string
	}{
		{method: http.MethodOptions, wantStatus: 204, wantBody: ""},
		{method: http.MethodPost, wantStatus: 405, wantBody: `{"error":"Method not allowed"}`},
		{method: http.MethodPut, wantStatus: 405, wantBody: `{"error":"Method not allowed"}`},
		{method: http.MethodDelete, wantStatus: 405, wantBody: `{"error":"Method not allowed"}`},
		{method: http.MethodPatch, wantStatus: 405, wantBody: `{"error":"Method not allowed"}`},
		{method: http.MethodHead, wantStatus: 405, wantBody: `{"error":"Method not allowed"}`},
	}
	for _, test := range tests {
		t.Run(test.method, func(t *testing.T) {
			source := &fakeSource{}
			response := get(NewVehiclesHandler(vehicles.NewFeed(source, time.Now)), test.method)
			if response.Code != test.wantStatus || response.Body.String() != test.wantBody {
				t.Errorf("response = %d %q, want %d %q", response.Code, response.Body.String(), test.wantStatus, test.wantBody)
			}
			assertCommonHeaders(t, response, "public, max-age=5, s-maxage=10")
			wantAllow := ""
			if test.wantStatus == http.StatusMethodNotAllowed {
				wantAllow = "GET, OPTIONS"
			}
			if got := response.Header().Get("Allow"); got != wantAllow {
				t.Errorf("Allow = %q, want %q", got, wantAllow)
			}
			if source.Calls() != 0 {
				t.Errorf("source called %d times for %s", source.Calls(), test.method)
			}
		})
	}
}

func TestHandlerUnknownPath(t *testing.T) {
	recorder := httptest.NewRecorder()
	NewVehiclesHandler(vehicles.NewFeed(&fakeSource{}, time.Now)).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, VehiclesPath+"/extra", nil))
	if recorder.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", recorder.Code)
	}
}

func TestHandlerPublishesMovementDirection(t *testing.T) {
	vehicleFeed, clock := newTestFeed(&movingSource{})
	handler := NewVehiclesHandler(vehicleFeed)

	decode := func() FeatureProperties {
		t.Helper()
		var body FeatureCollection
		raw := get(handler, "GET").Body.Bytes()
		validateContract(t, raw)
		err := json.Unmarshal(raw, &body)
		if err != nil || len(body.Features) != 1 {
			t.Fatalf("body: %+v, %v", body, err)
		}
		return body.Features[0].Properties
	}
	first := decode()
	if first.Bearing != nil || first.Heading != "" {
		t.Fatalf("first check must not publish a direction: %+v", first)
	}
	clock.Set(14 * time.Second)
	second := decode()
	if second.Bearing == nil || math.Abs(*second.Bearing) > 1 || second.Heading != headingMovement {
		t.Fatalf("second check = %+v, want bearing ~0 (north) from movement", second)
	}
}

// waitForObservedSnapshot waits until the observer has started the first refresh, then joins it.
// Waiting for the source call first keeps the observer, not this helper, in charge of the refresh.
func waitForObservedSnapshot(t *testing.T, feed *vehicles.Feed, source *movingSource) {
	t.Helper()
	waitFor(t, func() bool { return source.Calls() > 0 })
	_, err := feed.Current(context.Background())
	if err != nil {
		t.Fatalf("first snapshot: %v", err)
	}
}

// TestHandlerConcurrentRequests renders one shared snapshot from many goroutines, so the race
// detector catches a handler that mutates it.
func TestHandlerConcurrentRequests(t *testing.T) {
	const requests = 8
	vehicleFeed, clock := newTestFeed(&movingSource{})
	handler := NewVehiclesHandler(vehicleFeed)
	get(handler, http.MethodGet)
	clock.Set(cacheTTL)
	get(handler, http.MethodGet)

	responses := make([]*httptest.ResponseRecorder, requests)
	var group sync.WaitGroup
	for index := range responses {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			responses[index] = get(handler, http.MethodGet)
		}(index)
	}
	group.Wait()

	for index, response := range responses {
		if response.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d", index, response.Code)
		}
		validateContract(t, response.Body.Bytes())
		properties := decodeFeed(t, response.Body.Bytes()).Features[0].Properties
		if properties.Bearing == nil || properties.Heading != headingMovement {
			t.Errorf("request %d: direction = %+v, want movement", index, properties)
		}
	}
}

func TestStartServesOnlyObservedSnapshots(t *testing.T) {
	source := &movingSource{}
	vehicleFeed, clock := newTestFeed(source)
	observer := vehicles.NewObserver(vehicleFeed, time.Millisecond)
	handler := NewVehiclesHandler(observer)
	ctx, cancel := context.WithCancel(context.Background())
	observerStopped := observer.Start(ctx)
	t.Cleanup(func() {
		cancel()
		select {
		case <-observerStopped:
		case <-time.After(5 * time.Second):
			t.Error("background observer did not stop")
		}
	})
	if observer.Start(ctx) != observerStopped {
		t.Fatal("Start created a second background worker")
	}
	waitForObservedSnapshot(t, vehicleFeed, source)
	if observer.Ready() {
		t.Fatal("ready before observing two snapshots")
	}
	for _, test := range []struct {
		method string
		status int
	}{{"GET", 503}, {"OPTIONS", 204}, {"HEAD", 405}, {"POST", 405}} {
		response := get(handler, test.method)
		if response.Code != test.status {
			t.Fatalf("during observation %s: status = %d, want %d", test.method, response.Code, test.status)
		}
		if test.method == "GET" {
			assertCommonHeaders(t, response, noStoreCacheControl)
			body := decodeFeed(t, response.Body.Bytes())
			if !body.Stale || body.FetchedAt != nil || len(body.Features) != 0 || body.Error != unavailableMessage {
				t.Fatalf("observation exposed an unobserved snapshot: %+v", body)
			}
		}
	}
	clock.Set(cacheTTL)
	waitFor(t, observer.Ready)
	response := get(handler, "GET")
	if response.Code != 200 {
		t.Fatalf("first successful response: %d %s", response.Code, response.Body)
	}
	validateContract(t, response.Body.Bytes())
	body := decodeFeed(t, response.Body.Bytes())
	if len(body.Features) != 1 {
		t.Fatalf("vehicles = %+v", body.Features)
	}
	properties := body.Features[0].Properties
	if properties.Bearing == nil || *properties.Bearing != 0 || properties.Heading != headingMovement {
		t.Fatalf("first successful response direction = %+v, want north from movement", properties)
	}
	if calls := source.Calls(); calls != 2 {
		t.Fatalf("source calls = %d, want two shared observations", calls)
	}
}

func assertCommonHeaders(t *testing.T, response *httptest.ResponseRecorder, wantCacheControl string) {
	t.Helper()
	want := map[string]string{
		"Access-Control-Allow-Origin":  "*",
		"Access-Control-Allow-Methods": "GET, OPTIONS",
		"Content-Type":                 "application/json; charset=utf-8",
		"Cache-Control":                wantCacheControl,
		"X-Content-Type-Options":       "nosniff",
	}
	for name, value := range want {
		if got := response.Header().Get(name); got != value {
			t.Errorf("header %s = %q, want %q", name, got, value)
		}
	}
}

func decodeFeed(t *testing.T, body []byte) FeatureCollection {
	t.Helper()
	var collection FeatureCollection
	if err := json.Unmarshal(body, &collection); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	return collection
}

// validateContract checks a success body against packages/contracts/vehicles.schema.json.
func validateContract(t *testing.T, body []byte) {
	t.Helper()
	var document map[string]any
	if err := json.Unmarshal(body, &document); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
	for _, field := range []string{"type", "features", "fetchedAt", "stale", "source"} {
		if _, present := document[field]; !present {
			t.Fatalf("missing required field %q in %s", field, body)
		}
	}
	if document["type"] != "FeatureCollection" || document["source"] != sourceURL {
		t.Errorf("type/source = %v/%v", document["type"], document["source"])
	}
	if _, isBool := document["stale"].(bool); !isBool {
		t.Errorf("stale = %v, want boolean", document["stale"])
	}
	fetchedAt, isString := document["fetchedAt"].(string)
	if _, err := time.Parse(time.RFC3339Nano, fetchedAt); !isString || err != nil {
		t.Errorf("fetchedAt = %v, want date-time", document["fetchedAt"])
	}
	features, isArray := document["features"].([]any)
	if !isArray || len(features) > contractMaxFeatures {
		t.Fatalf("features = %v, want array of at most 2000", document["features"])
	}
	for index, item := range features {
		validateContractVehicle(t, index, item)
	}
}

// validateContractVehicle checks one element of the contract's features array.
func validateContractVehicle(t *testing.T, index int, item any) {
	t.Helper()
	vehicle, _ := item.(map[string]any)
	geometry, _ := vehicle["geometry"].(map[string]any)
	properties, _ := vehicle["properties"].(map[string]any)
	coordinates, _ := geometry["coordinates"].([]any)
	if vehicle["type"] != "Feature" || geometry["type"] != "Point" || len(coordinates) != 2 {
		t.Errorf("vehicle %d has invalid shape: %v", index, item)
		return
	}
	longitude, isLongitudeNumber := coordinates[0].(float64)
	latitude, isLatitudeNumber := coordinates[1].(float64)
	isInBounds := !math.IsNaN(longitude) && longitude >= contractMinLongitude && longitude <= contractMaxLongitude &&
		latitude >= contractMinLatitude && latitude <= contractMaxLatitude
	if !isLongitudeNumber || !isLatitudeNumber || !isInBounds {
		t.Errorf("vehicle %d coordinates out of bounds: %v", index, coordinates)
	}
	route, isRoute := properties["route"].(string)
	if length := len([]rune(route)); !isRoute || length < 1 || length > contractMaxRouteCharacters {
		t.Errorf("vehicle %d route = %v, want 1..%d characters", index, properties["route"], contractMaxRouteCharacters)
	}
	bearingValue, hasBearing := properties["bearing"]
	headingValue, hasHeading := properties["heading"]
	if hasBearing != hasHeading {
		t.Errorf("vehicle %d: bearing and heading must appear together: %v", index, properties)
	}
	if hasBearing {
		direction, isNumber := bearingValue.(float64)
		if !isNumber || direction < 0 || direction >= contractBearingLimit || headingValue != headingMovement {
			t.Errorf("vehicle %d direction = %v/%v, want [0, 360) from movement", index, bearingValue, headingValue)
		}
	}
}
