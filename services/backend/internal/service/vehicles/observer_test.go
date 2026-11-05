package vehicles

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// movingSource reports one vehicle that moves 0.001° north on every call.
type movingSource struct {
	mutex sync.Mutex
	calls int
}

func (s *movingSource) Vehicles(context.Context) ([]UpstreamVehicle, error) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.calls++
	return []UpstreamVehicle{{Route: "6A", Longitude: 19.26, Latitude: 42.44 + 0.001*float64(s.calls)}}, nil
}

func (s *movingSource) Calls() int {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	return s.calls
}

// TestOutageKeepsUpstreamRate: background retries during an outage stay at one request per cache
// period, however often the observer polls.
func TestOutageKeepsUpstreamRate(t *testing.T) {
	source := &fakeSource{fail: true}
	observer, _, clock := startTestObserver(t, source)
	waitFor(t, func() bool { return source.Calls() >= 1 })

	// many polls at 1 ms with the clock frozen
	time.Sleep(50 * time.Millisecond)
	if got := source.Calls(); got != 1 {
		t.Fatalf("source calls within one cache period = %d, want 1", got)
	}

	clock.Set(cacheTTL)
	waitFor(t, func() bool { return source.Calls() >= 2 })
	time.Sleep(50 * time.Millisecond)
	if got := source.Calls(); got != 2 {
		t.Fatalf("source calls within the second cache period = %d, want 2", got)
	}
	if observer.Ready() {
		t.Fatal("ready during an outage")
	}
}

func TestPollKeepsDirectionsCurrentAndStops(t *testing.T) {
	source := &movingSource{}
	vehicleFeed, clock := newTestFeed(source)
	observer := NewObserver(vehicleFeed, time.Millisecond)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	go func() {
		observer.poll(ctx)
		close(done)
	}()

	// each time the cache expires poll refreshes again, with no viewer request
	deadline := time.Now().Add(5 * time.Second)
	for {
		calls := source.Calls()
		if calls >= 3 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("poll made %d refreshes, want 3", calls)
		}
		// expire whichever snapshot is cached now
		if latestSnapshot := vehicleFeed.latest(); latestSnapshot != nil {
			clock.Set(latestSnapshot.FetchedAt.Sub(startTime) + 14*time.Second)
		}
		time.Sleep(time.Millisecond)
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("poll did not stop after cancellation")
	}

	// the moving vehicle already carries a movement direction for the first viewer
	latestSnapshot := vehicleFeed.latest()
	if latestSnapshot == nil || latestSnapshot.Vehicles[0].DirectionDegrees == nil {
		t.Fatalf("cached snapshot without movement direction: %+v", latestSnapshot)
	}
}

// waitForDirectionSnapshot waits for publication, rather than just the upstream call starting.
func waitForDirectionSnapshot(t *testing.T, vehicleFeed *Feed, fetchedAt time.Time) {
	t.Helper()
	waitFor(t, func() bool {
		latestSnapshot := vehicleFeed.latest()
		return latestSnapshot != nil && latestSnapshot.FetchedAt.Equal(fetchedAt)
	})
}

// TestObservationWaitsForTwoSnapshots: observation waits a full cache period, then the feed knows the direction.
func TestObservationWaitsForTwoSnapshots(t *testing.T) {
	source := &movingSource{}
	vehicleFeed, clock := newTestFeed(source)
	observer := NewObserver(vehicleFeed, time.Millisecond)
	done := make(chan error, 1)
	go func() { done <- observer.observeUntilMovementKnown(context.Background()) }()
	waitForDirectionSnapshot(t, vehicleFeed, startTime)
	select {
	case err := <-done:
		t.Fatalf("observation returned after only one observation: %v", err)
	default:
	}
	clock.Set(cacheTTL)
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("observation did not finish after the cache expired")
	}

	snapshot, err := vehicleFeed.Current(context.Background())
	if err != nil || len(snapshot.Vehicles) != 1 {
		t.Fatalf("Current = %+v, %v", snapshot, err)
	}
	direction := snapshot.Vehicles[0].DirectionDegrees
	if direction == nil || *direction != 0 {
		t.Fatalf("direction = %v, want north from movement", direction)
	}
	if calls := source.Calls(); calls != 2 {
		t.Fatalf("source calls = %d, want two shared observations", calls)
	}
}

func TestObservationStopsOnFailureOrCancellation(t *testing.T) {
	for _, scenario := range []string{"first fetch fails", "second fetch fails", "cancel while waiting", "already cancelled"} {
		t.Run(scenario, func(t *testing.T) {
			source := &fakeSource{fail: scenario == "first fetch fails"}
			vehicleFeed, clock := newTestFeed(source)
			observer := NewObserver(vehicleFeed, time.Millisecond)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			want := ErrUnavailable
			if scenario == "already cancelled" {
				cancel()
				want = context.Canceled
			}
			done := make(chan error, 1)
			go func() { done <- observer.observeUntilMovementKnown(ctx) }()
			switch scenario {
			case "second fetch fails":
				waitForDirectionSnapshot(t, vehicleFeed, startTime)
				source.SetFail(true)
				clock.Set(cacheTTL)
			case "cancel while waiting":
				waitForDirectionSnapshot(t, vehicleFeed, startTime)
				cancel()
				want = context.Canceled
			}
			select {
			case err := <-done:
				if !errors.Is(err, want) {
					t.Fatalf("observation error = %v, want %v", err, want)
				}
			case <-time.After(5 * time.Second):
				t.Fatal("observation did not stop")
			}
			if scenario == "already cancelled" && source.Calls() != 0 {
				t.Fatal("cancelled observation called the upstream")
			}
		})
	}
}

// startTestObserver starts background observation on a fake clock and stops it when the test ends.
func startTestObserver(t *testing.T, source Source) (*Observer, *Feed, *fakeClock) {
	t.Helper()
	vehicleFeed, clock := newTestFeed(source)
	observer := NewObserver(vehicleFeed, time.Millisecond)
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
	return observer, vehicleFeed, clock
}

func TestStartRetriesFailedObservation(t *testing.T) {
	for _, scenario := range []string{"first fetch fails", "second fetch fails"} {
		t.Run(scenario, func(t *testing.T) {
			source := &fakeSource{fail: scenario == "first fetch fails"}
			observer, vehicleFeed, clock := startTestObserver(t, source)
			if scenario == "second fetch fails" {
				waitForDirectionSnapshot(t, vehicleFeed, startTime)
				source.SetFail(true)
				clock.Set(cacheTTL)
			}
			waitFor(t, func() bool {
				vehicleFeed.mutex.Lock()
				defer vehicleFeed.mutex.Unlock()
				return vehicleFeed.failures.isFailing
			})
			_, err := observer.Current(context.Background())
			if observer.Ready() || !errors.Is(err, ErrUnavailable) {
				t.Fatalf("failed observation published an unobserved snapshot: %v", err)
			}
			// Recover at a new check time, then allow another cache period for observation.
			source.SetFail(false)
			clock.Set(2 * cacheTTL)
			waitForDirectionSnapshot(t, vehicleFeed, startTime.Add(2*cacheTTL))
			clock.Set(3 * cacheTTL)
			waitFor(t, observer.Ready)
			_, err = observer.Current(context.Background())
			if err != nil {
				t.Fatalf("observation did not recover without restarting: %v", err)
			}
		})
	}
}
