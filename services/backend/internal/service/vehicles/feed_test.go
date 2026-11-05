package vehicles

import (
	"context"
	"errors"
	"fmt"
	"strings"
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
	mutex   sync.Mutex
	current time.Time
	reads   int
}

func (c *fakeClock) Now() time.Time {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	c.reads++
	return c.current
}

func (c *fakeClock) Reads() int {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	return c.reads
}

func (c *fakeClock) ResetReads() {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	c.reads = 0
}

func (c *fakeClock) Set(offset time.Duration) {
	c.mutex.Lock()
	defer c.mutex.Unlock()
	c.current = startTime.Add(offset)
}

// fakeSource returns [sampleRow] or errOffline, counts calls, and can block on a gate.
type fakeSource struct {
	mutex sync.Mutex
	calls int
	fail  bool
	gate  chan struct{} // nil: answer immediately
}

func (s *fakeSource) Vehicles(context.Context) ([]UpstreamVehicle, error) {
	gate, fail := s.recordCall()
	if gate != nil {
		<-gate
	}
	if fail {
		return nil, errOffline
	}
	return []UpstreamVehicle{sampleRow}, nil
}

// recordCall counts a call and returns its behavior, so the call can block without holding the mutex.
func (s *fakeSource) recordCall() (gate chan struct{}, fail bool) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.calls++
	return s.gate, s.fail
}

func (s *fakeSource) SetGate(gate chan struct{}) {
	s.mutex.Lock()
	defer s.mutex.Unlock()
	s.gate = gate
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

// currentRefresh returns the in-flight refresh, or nil.
func (f *Feed) currentRefresh() *refreshCall {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	return f.inFlightRefresh
}

// latest returns the cached snapshot, or nil.
func (f *Feed) latest() *Snapshot {
	f.mutex.Lock()
	defer f.mutex.Unlock()
	return f.latestSnapshot
}

func newTestFeed(source Source) (*Feed, *fakeClock) {
	clock := &fakeClock{current: startTime}
	return NewFeed(source, clock.Now), clock
}

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

type sourceFunc func(context.Context) ([]UpstreamVehicle, error)

func (f sourceFunc) Vehicles(ctx context.Context) ([]UpstreamVehicle, error) { return f(ctx) }

func TestUnavailableSource(t *testing.T) {
	_, err := Unavailable{}.Vehicles(context.Background())
	if !errors.Is(err, ErrSourceNotConfigured) {
		t.Fatalf("Unavailable.Vehicles error = %v, want ErrSourceNotConfigured", err)
	}
}

func TestFeedSingleFlight(t *testing.T) {
	const requests = 8
	source := &fakeSource{}
	vehicleFeed, clock := newTestFeed(source)

	// seed an expired snapshot: every later request then reads the clock exactly once on entry,
	// inside the same critical section where it starts or joins the refresh
	_, err := vehicleFeed.Current(context.Background())
	if err != nil {
		t.Fatalf("seed: %v", err)
	}
	clock.Set(61 * time.Second)
	clock.ResetReads()
	gate := make(chan struct{})
	source.SetGate(gate)

	// start concurrent requests while the refresh is blocked
	snapshots := make([]Snapshot, requests)
	errs := make([]error, requests)
	var group sync.WaitGroup
	for index := range snapshots {
		group.Add(1)
		go func(index int) {
			defer group.Done()
			snapshots[index], errs[index] = vehicleFeed.Current(context.Background())
		}(index)
	}
	// every request has entered; taking the lock waits until the last one has joined
	waitFor(t, func() bool { return clock.Reads() >= requests })
	if vehicleFeed.currentRefresh() == nil {
		t.Fatal("no shared refresh in flight")
	}
	close(gate)
	group.Wait()

	for index, snapshot := range snapshots {
		if errs[index] != nil {
			t.Fatalf("request %d: %v", index, errs[index])
		}
		if snapshot.Stale || len(snapshot.Vehicles) != 1 {
			t.Errorf("request %d: snapshot = %+v, want the shared fresh refresh", index, snapshot)
		}
	}
	// seed + one shared refresh; a follow-up request hits the fresh cache
	_, err = vehicleFeed.Current(context.Background())
	if err != nil {
		t.Fatalf("follow-up: %v", err)
	}
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
	snapshot, err := vehicleFeed.Current(context.Background())
	if err != nil || snapshot.Stale || len(snapshot.Vehicles) != 1 {
		t.Fatalf("Current = %+v, %v", snapshot, err)
	}
	if got := source.Calls(); got != 1 {
		t.Errorf("source calls = %d, want 1", got)
	}
}

func TestFeedRefreshTimeout(t *testing.T) {
	// source ignores ctx and blocks until the gate opens
	source := &fakeSource{gate: make(chan struct{})}
	vehicleFeed, clock := newTestFeed(source)
	vehicleFeed.refreshTimeout = 20 * time.Millisecond

	snapshot, err := vehicleFeed.Current(context.Background())
	if !errors.Is(err, ErrUnavailable) || !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("Current error = %v, want ErrUnavailable wrapping DeadlineExceeded", err)
	}
	if !snapshot.FetchedAt.IsZero() || snapshot.Vehicles != nil {
		t.Errorf("snapshot = %+v, want none", snapshot)
	}
	if vehicleFeed.currentRefresh() != nil {
		t.Fatal("in-flight refresh not cleared after timeout")
	}

	// once the abandoned call returns and the failure's cache period passes, a later request
	// starts a fresh refresh instead of hanging
	close(source.gate)
	clock.Set(cacheTTL)
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
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			source := &fakeSource{}
			vehicleFeed, clock := newTestFeed(source)
			vehicleFeed.refreshTimeout = 20 * time.Millisecond
			seedCalls := 0
			if test.seed {
				if _, err := vehicleFeed.Current(context.Background()); err != nil {
					t.Fatalf("seed: %v", err)
				}
				seedCalls = 1
			}

			// a ctx-ignoring call times out and keeps running
			gate := make(chan struct{})
			t.Cleanup(func() { close(gate) })
			source.SetGate(gate)
			clock.Set(test.retryAt)
			_, _ = vehicleFeed.Current(context.Background())

			// later requests must not start another source call
			for attempt := 0; attempt < 3; attempt++ {
				snapshot, err := vehicleFeed.Current(context.Background())
				if !errors.Is(err, test.wantErr) {
					t.Fatalf("attempt %d: error = %v, want %v", attempt, err, test.wantErr)
				}
				if snapshot.Stale != test.wantStale || len(snapshot.Vehicles) != test.wantRoutes {
					t.Errorf("attempt %d: snapshot = %+v", attempt, snapshot)
				}
			}
			if got := source.Calls(); got != seedCalls+1 {
				t.Errorf("source calls = %d, want %d", got, seedCalls+1)
			}
		})
	}
}

// TestFeedBacksOffAfterFailure: an outage costs the upstream one request per cache period, however
// many callers ask.
func TestFeedBacksOffAfterFailure(t *testing.T) {
	source := &fakeSource{fail: true}
	vehicleFeed, clock := newTestFeed(source)
	vehicleFeed.logf = func(string, ...any) {}
	current := func() (Snapshot, error) { return vehicleFeed.Current(context.Background()) }

	// the failure itself, then repeated callers without a new request
	_, err := current()
	if !errors.Is(err, ErrUnavailable) || !errors.Is(err, errOffline) {
		t.Fatalf("first failure: %v", err)
	}
	for attempt := 0; attempt < 3; attempt++ {
		_, err = current()
		if !errors.Is(err, ErrUnavailable) || !errors.Is(err, ErrRefreshBackingOff) {
			t.Fatalf("attempt %d: error = %v, want ErrRefreshBackingOff", attempt, err)
		}
	}
	if got := source.Calls(); got != 1 {
		t.Fatalf("source calls during backoff = %d, want 1", got)
	}

	// just before the cache period ends there is still no request
	clock.Set(cacheTTL - time.Millisecond)
	_, err = current()
	if !errors.Is(err, ErrRefreshBackingOff) || source.Calls() != 1 {
		t.Fatalf("before the period ends: error = %v, calls = %d", err, source.Calls())
	}

	// the next period allows one retry, which recovers
	source.SetFail(false)
	clock.Set(cacheTTL)
	snapshot, err := current()
	if err != nil || snapshot.Stale || source.Calls() != 2 {
		t.Fatalf("retry = %+v, %v, calls = %d", snapshot, err, source.Calls())
	}

	// after a success, the next refresh is tried as soon as the cache expires
	source.SetFail(true)
	clock.Set(2 * cacheTTL)
	staleSnapshot, err := current()
	if err != nil || !staleSnapshot.Stale || source.Calls() != 3 {
		t.Fatalf("after expiry = %+v, %v, calls = %d", staleSnapshot, err, source.Calls())
	}

	// during backoff with a recent snapshot, callers get it as stale without a new request
	staleSnapshot, err = current()
	if err != nil || !staleSnapshot.Stale || source.Calls() != 3 {
		t.Fatalf("stale during backoff = %+v, %v, calls = %d", staleSnapshot, err, source.Calls())
	}
}

func TestFeedNormalizationFailureIsUnavailable(t *testing.T) {
	vehicleFeed, _ := newTestFeed(sourceFunc(func(context.Context) ([]UpstreamVehicle, error) {
		return []UpstreamVehicle{{Route: "", Longitude: 19, Latitude: 42}}, nil
	}))
	_, err := vehicleFeed.Current(context.Background())
	if !errors.Is(err, ErrUnavailable) || !errors.Is(err, ErrNoValidVehicles) {
		t.Fatalf("Current error = %v", err)
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
