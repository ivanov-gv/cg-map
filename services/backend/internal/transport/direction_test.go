package transport

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func vehicleAt(route string, longitude, latitude float64) Feature {
	return Feature{Type: featureType, Geometry: Point{Type: pointType, Coordinates: [2]float64{longitude, latitude}}, Properties: FeatureProperties{Route: route}}
}

// headings returns each feature's bearing, or -1 without one.
func headings(t *testing.T, features []Feature) []float64 {
	t.Helper()
	result := make([]float64, len(features))
	for index, feature := range features {
		result[index] = -1
		if feature.Properties.Bearing != nil {
			if feature.Properties.Heading != HeadingMovement {
				t.Fatalf("feature %d: bearing without heading %q", index, feature.Properties.Heading)
			}
			result[index] = *feature.Properties.Bearing
		}
	}
	return result
}

// directionCases is packages/contracts/fixtures/vehicle-direction-cases.json, shared with the browser tracker's tests.
type directionCases struct {
	Cases []struct {
		Name   string            `json:"name"`
		Checks []json.RawMessage `json:"checks"`
		Want   []*float64        `json:"want"`
	} `json:"cases"`
}

func TestDirectionTracker(t *testing.T) {
	raw, err := os.ReadFile("../../../../packages/contracts/fixtures/vehicle-direction-cases.json")
	if err != nil {
		t.Fatal(err)
	}
	var fixture directionCases
	err = json.Unmarshal(raw, &fixture)
	if err != nil {
		t.Fatal(err)
	}
	for _, test := range fixture.Cases {
		t.Run(test.Name, func(t *testing.T) {
			var tracker directionTracker
			var output []Feature
			for _, check := range test.Checks {
				var at int64
				var buses [][3]json.RawMessage
				err := json.Unmarshal(check, &[]any{&at, &buses})
				if err != nil {
					t.Fatalf("check %s: %v", check, err)
				}
				features := make([]Feature, len(buses))
				for index, bus := range buses {
					var route string
					var longitude, latitude float64
					if json.Unmarshal(bus[0], &route) != nil || json.Unmarshal(bus[1], &longitude) != nil || json.Unmarshal(bus[2], &latitude) != nil {
						t.Fatalf("bus %v", bus)
					}
					features[index] = vehicleAt(route, longitude, latitude)
				}
				output = tracker.update(features, startTime.Add(time.Duration(at)*time.Millisecond))
			}
			got := headings(t, output)
			if len(got) != len(test.Want) {
				t.Fatalf("headings = %v, want %d buses", got, len(test.Want))
			}
			for index, want := range test.Want {
				if want == nil && got[index] != -1 || want != nil && math.Abs(got[index]-*want) > 0.11 {
					t.Fatalf("bus %d heading = %v, want %v", index, got[index], formatWant(want))
				}
			}
		})
	}
}

func formatWant(want *float64) any {
	if want == nil {
		return "none"
	}
	return *want
}

func TestBearingStaysBelow360(t *testing.T) {
	var tracker directionTracker
	tracker.update([]Feature{vehicleAt("6", 19.26, 42.44)}, startTime)
	// almost due north, slightly west: rounds to 360.0 before wrapping
	output := tracker.update([]Feature{vehicleAt("6", 19.2599999, 42.441)}, startTime.Add(13*time.Second))
	if got := *output[0].Properties.Bearing; got < 0 || got >= 360 {
		t.Fatalf("bearing = %v, want [0, 360)", got)
	}
}

// movingSource reports one bus that moves 0.001° north on every call.
type movingSource struct {
	mu    sync.Mutex
	calls int
}

func (s *movingSource) Vehicles(context.Context) ([]Vehicle, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	return []Vehicle{{Route: "6A", Longitude: 19.26, Latitude: 42.44 + 0.001*float64(s.calls)}}, nil
}

func TestHandlerPublishesMovementDirection(t *testing.T) {
	vehicleFeed, clock := newTestFeed(&movingSource{})
	handler := newHandler(vehicleFeed)

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
	if second.Bearing == nil || math.Abs(*second.Bearing) > 1 || second.Heading != HeadingMovement {
		t.Fatalf("second check = %+v, want bearing ~0 (north) from movement", second)
	}
}

func TestPollKeepsDirectionsWarmAndStops(t *testing.T) {
	source := &movingSource{}
	vehicleFeed, clock := newTestFeed(source)
	handler := &Handler{Handler: newHandler(vehicleFeed), feed: vehicleFeed, pollInterval: time.Millisecond}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		handler.Poll(ctx)
		close(done)
	}()

	// each time the cache expires Poll refreshes again, with no viewer request
	deadline := time.Now().Add(5 * time.Second)
	for {
		source.mu.Lock()
		calls := source.calls
		source.mu.Unlock()
		if calls >= 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("Poll made %d refreshes, want 3", calls)
		}
		// expire whichever snapshot is cached now
		vehicleFeed.mu.Lock()
		if vehicleFeed.cached != nil {
			clock.Set(vehicleFeed.cached.fetchedAt.Sub(startTime) + 14*time.Second)
		}
		vehicleFeed.mu.Unlock()
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Poll did not stop after cancellation")
	}

	// the moving bus already carries a movement bearing for the first viewer
	vehicleFeed.mu.Lock()
	cached := vehicleFeed.cached
	vehicleFeed.mu.Unlock()
	if cached == nil || cached.features[0].Properties.Heading != HeadingMovement {
		t.Fatalf("cached snapshot without movement direction: %+v", cached)
	}
}

func TestFeedLogsFailuresRateLimitedAndRecovery(t *testing.T) {
	source := &fakeSource{fail: true}
	vehicleFeed, clock := newTestFeed(source)
	var logs []string
	vehicleFeed.logf = func(format string, args ...any) { logs = append(logs, fmt.Sprintf(format, args...)) }

	for _, offset := range []time.Duration{0, 14 * time.Second, 28 * time.Second, 61 * time.Second} {
		clock.Set(offset)
		_, _ = vehicleFeed.Current(context.Background())
	}
	source.SetFail(false)
	clock.Set(75 * time.Second)
	_, _ = vehicleFeed.Current(context.Background())

	if len(logs) != 3 {
		t.Fatalf("logs = %q, want first failure, one rate-limited report, recovery", logs)
	}
	if !strings.Contains(logs[0], "offline") || !strings.Contains(logs[1], "(2 more failures") || !strings.Contains(logs[2], "recovered") {
		t.Fatalf("logs = %q", logs)
	}
}
