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
)

var (
	errOffline = errors.New("offline")
	startTime  = time.Date(2026, 11, 1, 12, 0, 0, 0, time.UTC)
)

// fakeClock is a manually advanced clock that counts reads.
type fakeClock struct {
	mu      sync.Mutex
	current time.Time
	reads   int
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reads++
	return c.current
}

func (c *fakeClock) Reads() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.reads
}

func (c *fakeClock) ResetReads() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.reads = 0
}

func (c *fakeClock) Set(offset time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.current = startTime.Add(offset)
}

// fakeSource returns [bus] or errOffline, counts calls, and can block on a gate.
type fakeSource struct {
	mu    sync.Mutex
	calls int
	fail  bool
	gate  chan struct{} // nil: answer immediately
}

func (s *fakeSource) Vehicles(context.Context) ([]Vehicle, error) {
	s.mu.Lock()
	s.calls++
	gate, fail := s.gate, s.fail
	s.mu.Unlock()
	if gate != nil {
		<-gate
	}
	if fail {
		return nil, errOffline
	}
	return []Vehicle{bus}, nil
}

func (s *fakeSource) SetFail(fail bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.fail = fail
}

func (s *fakeSource) Calls() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

func newTestFeed(source Source) (*feed, *fakeClock) {
	clock := &fakeClock{current: startTime}
	return newFeed(source, clock.Now), clock
}

func get(handler http.Handler, method string) *httptest.ResponseRecorder {
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(method, VehiclesPath, nil))
	return recorder
}

func TestHandlerCache(t *testing.T) {
	type step struct {
		at               time.Duration
		fail             bool
		wantStatus       int
		wantStale        bool
		wantFeatures     int
		wantFetchedAt    string // "" means null
		wantCalls        int
		wantCacheControl string
	}
	const (
		public  = "public, max-age=5, s-maxage=10"
		noStore = "no-store"
		fetched = "2026-11-01T12:00:00.000Z"
	)
	ok := func(at time.Duration, fetchedAt string, calls int) step {
		return step{at: at, wantStatus: 200, wantFeatures: 1, wantFetchedAt: fetchedAt, wantCalls: calls, wantCacheControl: public}
	}
	stale := func(at time.Duration, calls int) step {
		return step{at: at, fail: true, wantStatus: 200, wantStale: true, wantFeatures: 1, wantFetchedAt: fetched, wantCalls: calls, wantCacheControl: noStore}
	}
	unavailable := func(at time.Duration, calls int) step {
		return step{at: at, fail: true, wantStatus: 503, wantStale: true, wantCalls: calls, wantCacheControl: noStore}
	}

	tests := []struct {
		name  string
		steps []step
	}{
		{
			name: "fresh cache served without calling the source",
			steps: []step{
				ok(0, fetched, 1),
				{at: 12999 * time.Millisecond, fail: true, wantStatus: 200, wantFeatures: 1, wantFetchedAt: fetched, wantCalls: 1, wantCacheControl: public},
			},
		},
		{
			name:  "refresh after TTL succeeds",
			steps: []step{ok(0, fetched, 1), ok(13*time.Second, "2026-11-01T12:00:13.000Z", 2)},
		},
		{
			name:  "failure within 60s serves stale snapshot",
			steps: []step{ok(0, fetched, 1), stale(14*time.Second, 2), stale(60*time.Second, 3)},
		},
		{
			name:  "failure after 60s is unavailable",
			steps: []step{ok(0, fetched, 1), unavailable(60*time.Second+time.Millisecond, 2)},
		},
		{
			// port of relay.test.mjs outage test
			name: "outage is stale, then expires, then recovers",
			steps: []step{
				ok(0, fetched, 1),
				stale(14*time.Second, 2),
				unavailable(61*time.Second, 3),
				ok(61*time.Second, "2026-11-01T12:01:01.000Z", 4),
			},
		},
		{
			name:  "first refresh failure is unavailable",
			steps: []step{unavailable(0, 1)},
		},
		{
			name:  "fetchedAt has millisecond precision",
			steps: []step{ok(1234567*time.Microsecond, "2026-11-01T12:00:01.234Z", 1)},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			source := &fakeSource{}
			vehicleFeed, clock := newTestFeed(source)
			handler := newHandler(vehicleFeed)
			for index, current := range tt.steps {
				clock.Set(current.at)
				source.SetFail(current.fail)
				response := get(handler, http.MethodGet)

				if response.Code != current.wantStatus {
					t.Fatalf("step %d: status = %d, want %d", index, response.Code, current.wantStatus)
				}
				assertCommonHeaders(t, response, current.wantCacheControl)
				body := decodeFeed(t, response.Body.Bytes())
				if body.Stale != current.wantStale || len(body.Features) != current.wantFeatures {
					t.Errorf("step %d: stale=%v features=%d, want %v/%d", index, body.Stale, len(body.Features), current.wantStale, current.wantFeatures)
				}
				gotFetchedAt := ""
				if body.FetchedAt != nil {
					gotFetchedAt = *body.FetchedAt
				}
				if gotFetchedAt != current.wantFetchedAt {
					t.Errorf("step %d: fetchedAt = %q, want %q", index, gotFetchedAt, current.wantFetchedAt)
				}
				if got := source.Calls(); got != current.wantCalls {
					t.Errorf("step %d: source calls = %d, want %d", index, got, current.wantCalls)
				}
				if response.Code == http.StatusOK {
					validateContract(t, response.Body.Bytes())
				}
			}
		})
	}
}

func TestHandlerBodies(t *testing.T) {
	tests := []struct {
		name       string
		source     Source
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
			name:       "default unavailable source answers 503",
			source:     Unavailable{},
			wantStatus: 503,
			wantBody:   `{"type":"FeatureCollection","features":[],"fetchedAt":null,"source":"https://epodgorica.me/javniprevoz/mapa","stale":true,"error":"Live bus positions are temporarily unavailable"}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vehicleFeed, _ := newTestFeed(tt.source)
			response := get(newHandler(vehicleFeed), http.MethodGet)
			if response.Code != tt.wantStatus || response.Body.String() != tt.wantBody {
				t.Errorf("response = %d %s\nwant %d %s", response.Code, response.Body.String(), tt.wantStatus, tt.wantBody)
			}
		})
	}
}

func TestUnavailableSource(t *testing.T) {
	_, err := Unavailable{}.Vehicles(context.Background())
	if !errors.Is(err, ErrSourceNotConfigured) {
		t.Fatalf("Unavailable.Vehicles error = %v, want ErrSourceNotConfigured", err)
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
	for _, tt := range tests {
		t.Run(tt.method, func(t *testing.T) {
			source := &fakeSource{}
			response := get(NewHandler(source), tt.method)
			if response.Code != tt.wantStatus || response.Body.String() != tt.wantBody {
				t.Errorf("response = %d %q, want %d %q", response.Code, response.Body.String(), tt.wantStatus, tt.wantBody)
			}
			assertCommonHeaders(t, response, "public, max-age=5, s-maxage=10")
			wantAllow := ""
			if tt.wantStatus == http.StatusMethodNotAllowed {
				wantAllow = "GET, OPTIONS"
			}
			if got := response.Header().Get("Allow"); got != wantAllow {
				t.Errorf("Allow = %q, want %q", got, wantAllow)
			}
			if source.Calls() != 0 {
				t.Errorf("source called %d times for %s", source.Calls(), tt.method)
			}
		})
	}
}

func TestHandlerUnknownPath(t *testing.T) {
	recorder := httptest.NewRecorder()
	NewHandler(&fakeSource{}).ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, VehiclesPath+"/extra", nil))
	if recorder.Code != http.StatusNotFound {
		t.Errorf("status = %d, want 404", recorder.Code)
	}
}

func TestHandlerSingleFlight(t *testing.T) {
	const requests = 8
	source := &fakeSource{}
	vehicleFeed, clock := newTestFeed(source)
	handler := newHandler(vehicleFeed)

	// seed an expired snapshot: every later request then reads the clock exactly once on entry,
	// inside the same critical section where it starts or joins the refresh
	get(handler, http.MethodGet)
	clock.Set(61 * time.Second)
	clock.ResetReads()
	source.mu.Lock()
	source.gate = make(chan struct{})
	source.mu.Unlock()

	// start concurrent requests while the refresh is blocked
	responses := make([]*httptest.ResponseRecorder, requests)
	var group sync.WaitGroup
	for index := range responses {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			responses[index] = get(handler, http.MethodGet)
		}(index)
	}
	// every request has entered; taking the lock waits until the last one has joined
	waitFor(t, func() bool { return clock.Reads() >= requests })
	vehicleFeed.mu.Lock()
	vehicleFeed.mu.Unlock()
	close(source.gate)
	group.Wait()

	for index, response := range responses {
		if response.Code != http.StatusOK {
			t.Fatalf("request %d: status = %d", index, response.Code)
		}
		if body := decodeFeed(t, response.Body.Bytes()); body.Stale {
			t.Errorf("request %d: stale response, want shared fresh refresh", index)
		}
		validateContract(t, response.Body.Bytes())
	}
	// seed + one shared refresh; a follow-up request hits the fresh cache
	get(handler, http.MethodGet)
	if got := source.Calls(); got != 2 {
		t.Errorf("source calls = %d, want 2", got)
	}
}

func TestFeedCallerCancellationKeepsSharedRefresh(t *testing.T) {
	source := &fakeSource{gate: make(chan struct{})}
	vehicleFeed, _ := newTestFeed(source)

	// first caller starts the refresh and leaves
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := vehicleFeed.Current(ctx)
		done <- err
	}()
	waitFor(t, func() bool { return source.Calls() == 1 })
	cancel()
	if err := <-done; !errors.Is(err, ErrUnavailable) || !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled caller error = %v", err)
	}

	// the refresh still completes for the next caller
	close(source.gate)
	collection, err := vehicleFeed.Current(context.Background())
	if err != nil || collection.Stale || len(collection.Features) != 1 {
		t.Fatalf("Current = %+v, %v", collection, err)
	}
	if got := source.Calls(); got != 1 {
		t.Errorf("source calls = %d, want 1", got)
	}
}

func TestFeedRefreshTimeout(t *testing.T) {
	// source ignores ctx and blocks until the gate opens
	source := &fakeSource{gate: make(chan struct{})}
	vehicleFeed, _ := newTestFeed(source)
	vehicleFeed.refreshTimeout = 20 * time.Millisecond

	collection, err := vehicleFeed.Current(context.Background())
	if !errors.Is(err, ErrUnavailable) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Current error = %v, want ErrUnavailable wrapping DeadlineExceeded", err)
	}
	if collection.Error == "" || collection.FetchedAt != nil {
		t.Errorf("collection = %+v, want unavailable body", collection)
	}
	vehicleFeed.mu.Lock()
	pending := vehicleFeed.pending
	vehicleFeed.mu.Unlock()
	if pending != nil {
		t.Fatal("pending refresh not cleared after timeout")
	}

	// once the abandoned call returns, a later request starts a fresh refresh instead of hanging
	close(source.gate)
	waitFor(t, func() bool {
		_, err := vehicleFeed.Current(context.Background())
		return err == nil
	})
	if got := source.Calls(); got != 2 {
		t.Errorf("source calls = %d, want 2", got)
	}
}

func TestFeedDoesNotStackAbandonedSourceCalls(t *testing.T) {
	tests := []struct {
		name       string
		seed       bool // successful snapshot at t=0 before the outage
		retryAt    time.Duration
		wantStale  bool
		wantErr    error
		wantRoutes int
	}{
		{name: "no snapshot: unavailable", retryAt: 14 * time.Second, wantErr: ErrSourceBusy},
		{name: "recent snapshot: stale", seed: true, retryAt: 14 * time.Second, wantStale: true, wantRoutes: 1},
		{name: "expired snapshot: unavailable", seed: true, retryAt: 61 * time.Second, wantErr: ErrSourceBusy},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			source := &fakeSource{}
			vehicleFeed, clock := newTestFeed(source)
			vehicleFeed.refreshTimeout = 20 * time.Millisecond
			seedCalls := 0
			if tt.seed {
				if _, err := vehicleFeed.Current(context.Background()); err != nil {
					t.Fatalf("seed: %v", err)
				}
				seedCalls = 1
			}

			// a ctx-ignoring call times out and keeps running
			gate := make(chan struct{})
			t.Cleanup(func() { close(gate) })
			source.mu.Lock()
			source.gate = gate
			source.mu.Unlock()
			clock.Set(tt.retryAt)
			_, _ = vehicleFeed.Current(context.Background())

			// later requests must not start another source call
			for attempt := 0; attempt < 3; attempt++ {
				collection, err := vehicleFeed.Current(context.Background())
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("attempt %d: error = %v, want %v", attempt, err, tt.wantErr)
				}
				if collection.Stale != (tt.wantStale || tt.wantErr != nil) || len(collection.Features) != tt.wantRoutes {
					t.Errorf("attempt %d: collection = %+v", attempt, collection)
				}
			}
			if got := source.Calls(); got != seedCalls+1 {
				t.Errorf("source calls = %d, want %d", got, seedCalls+1)
			}
		})
	}
}

func TestFeedNormalizationFailureIsUnavailable(t *testing.T) {
	vehicleFeed, _ := newTestFeed(sourceFunc(func(context.Context) ([]Vehicle, error) {
		return []Vehicle{{Route: "", Longitude: 19, Latitude: 42}}, nil
	}))
	_, err := vehicleFeed.Current(context.Background())
	if !errors.Is(err, ErrUnavailable) || !errors.Is(err, ErrNoValidVehicles) {
		t.Fatalf("Current error = %v", err)
	}
}

type sourceFunc func(context.Context) ([]Vehicle, error)

func (f sourceFunc) Vehicles(ctx context.Context) ([]Vehicle, error) { return f(ctx) }

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
	if document["type"] != "FeatureCollection" || document["source"] != SourceURL {
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
	if !isArray || len(features) > 2000 {
		t.Fatalf("features = %v, want array of at most 2000", document["features"])
	}
	for index, item := range features {
		feature, _ := item.(map[string]any)
		geometry, _ := feature["geometry"].(map[string]any)
		properties, _ := feature["properties"].(map[string]any)
		coordinates, _ := geometry["coordinates"].([]any)
		if feature["type"] != "Feature" || geometry["type"] != "Point" || len(coordinates) != 2 {
			t.Errorf("feature %d has invalid shape: %v", index, item)
			continue
		}
		longitude, lonOK := coordinates[0].(float64)
		latitude, latOK := coordinates[1].(float64)
		if !lonOK || !latOK || math.IsNaN(longitude) || longitude < 17.8 || longitude > 21 || latitude < 41.3 || latitude > 44.1 {
			t.Errorf("feature %d coordinates out of bounds: %v", index, coordinates)
		}
		route, isRoute := properties["route"].(string)
		if length := len([]rune(route)); !isRoute || length < 1 || length > 32 {
			t.Errorf("feature %d route = %v, want 1..32 characters", index, properties["route"])
		}
		bearingValue, hasBearing := properties["bearing"]
		headingValue, hasHeading := properties["heading"]
		if hasBearing != hasHeading {
			t.Errorf("feature %d: bearing and heading must appear together: %v", index, properties)
		}
		if hasBearing {
			direction, isNumber := bearingValue.(float64)
			if !isNumber || direction < 0 || direction >= 360 || headingValue != HeadingMovement {
				t.Errorf("feature %d direction = %v/%v, want [0, 360) from movement", index, bearingValue, headingValue)
			}
		}
	}
}
