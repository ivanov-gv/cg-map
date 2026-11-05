package vehicles

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"
)

// Feed caches the last normalized snapshot: a 13s fresh window, one shared in-flight refresh, and
// stale snapshots served until 60s after their check time, as in relay.mjs. Unlike the relay, a
// failed refresh is not retried for 13s.
type Feed struct {
	source         Source
	now            func() time.Time
	logf           func(format string, args ...any)
	refreshTimeout time.Duration

	// mutex guards the fields below it, up to directions
	mutex           sync.Mutex
	latestSnapshot  *Snapshot
	inFlightRefresh *refreshCall
	// isSourceRunning stays true until Source.Vehicles returns, even after a refresh timed out,
	// so a source that ignores ctx never has more than one call outstanding.
	isSourceRunning bool
	// lastFailureAt is when a refresh last failed. It holds back retries, so an outage costs the
	// upstream no more requests than normal operation. A success needs no reset: its fresh window
	// outlasts any earlier failure's backoff.
	lastFailureAt time.Time
	failures      failureReporter

	// directions is used only inside fetchSnapshot, which runs for one refresh at a time
	directions directionTracker
}

// refreshCall is one in-flight upstream refresh shared by every concurrent request.
type refreshCall struct {
	done   chan struct{} // closed once result/err are set
	result *Snapshot
	err    error
}

// NewFeed returns a feed reading source; now supplies the check times.
func NewFeed(source Source, now func() time.Time) *Feed {
	return &Feed{
		source:         source,
		now:            now,
		refreshTimeout: defaultRefreshTimeout,
		logf:           log.Printf,
	}
}

// Current returns a fresh snapshot, a refreshed one, or a stale one (Stale: true) within 60s of
// its check time. Otherwise it returns an error wrapping ErrUnavailable. The upstream sees at most
// one request per cache period, including during an outage.
func (f *Feed) Current(ctx context.Context) (Snapshot, error) {
	freshSnapshot, refresh, refreshBlockedBy := f.freshSnapshotOrRefresh()
	if refreshBlockedBy != nil {
		return f.staleOrUnavailable(refreshBlockedBy)
	}
	if freshSnapshot != nil {
		return *freshSnapshot, nil
	}

	// wait without letting one caller's cancellation affect the shared refresh
	select {
	case <-refresh.done:
	case <-ctx.Done():
		return Snapshot{}, fmt.Errorf("Feed.Current: %w: %w", ErrUnavailable, ctx.Err())
	}
	if refresh.err == nil {
		return *refresh.result, nil
	}
	return f.staleOrUnavailable(refresh.err)
}

// freshSnapshotOrRefresh returns exactly one of: the cached snapshot while it is fresh, the refresh
// to wait for (started if needed), or the reason no refresh can start now.
func (f *Feed) freshSnapshotOrRefresh() (*Snapshot, *refreshCall, error) {
	f.mutex.Lock()
	defer f.mutex.Unlock()

	now := f.now()
	if f.latestSnapshot != nil && now.Sub(f.latestSnapshot.FetchedAt) < cacheTTL {
		return f.latestSnapshot, nil, nil
	}
	if f.inFlightRefresh != nil {
		return nil, f.inFlightRefresh, nil
	}
	if f.isSourceRunning {
		return nil, nil, ErrSourceBusy
	}
	if !f.lastFailureAt.IsZero() && now.Sub(f.lastFailureAt) < cacheTTL {
		return nil, nil, ErrRefreshBackingOff
	}
	f.inFlightRefresh = &refreshCall{done: make(chan struct{})}
	f.isSourceRunning = true
	go f.runRefresh(f.inFlightRefresh)
	return nil, f.inFlightRefresh, nil
}

// staleOrUnavailable serves the previous snapshot as stale while it is at most 60s old, otherwise an error.
func (f *Feed) staleOrUnavailable(cause error) (Snapshot, error) {
	previousSnapshot := f.unexpiredSnapshot()
	if previousSnapshot == nil {
		return Snapshot{}, fmt.Errorf("Feed.Current: %w: %w", ErrUnavailable, cause)
	}
	staleSnapshot := *previousSnapshot
	staleSnapshot.Stale = true
	return staleSnapshot, nil
}

// unexpiredSnapshot returns the latest snapshot, or nil without one at most 60s old.
func (f *Feed) unexpiredSnapshot() *Snapshot {
	f.mutex.Lock()
	defer f.mutex.Unlock()

	if f.latestSnapshot == nil || f.now().Sub(f.latestSnapshot.FetchedAt) > maxStaleAge {
		return nil
	}
	return f.latestSnapshot
}

// runRefresh fetches and normalizes one upstream snapshot, then publishes it to the refresh's waiters.
func (f *Feed) runRefresh(refresh *refreshCall) {
	result, err := f.fetchSnapshot()
	// publish before releasing waiters, so a later request sees the new cache
	logLine := f.publish(refresh, result, err)
	if logLine != "" {
		f.logf("%s", logLine)
	}
	close(refresh.done)
}

// publish records a refresh's outcome and returns the line to log, or "" for none. A nil err makes
// result the latest snapshot.
func (f *Feed) publish(refresh *refreshCall, result *Snapshot, err error) string {
	f.mutex.Lock()
	defer f.mutex.Unlock()

	now := f.now()
	if err == nil {
		f.latestSnapshot = result
	} else {
		f.lastFailureAt = now
	}
	f.inFlightRefresh = nil
	refresh.result, refresh.err = result, err
	return f.failures.recordOutcome(err, now)
}

// markSourceFinished allows the next source call, once the previous one has returned.
func (f *Feed) markSourceFinished() {
	f.mutex.Lock()
	defer f.mutex.Unlock()

	f.isSourceRunning = false
}

// fetchSnapshot reads the source with a hard timeout, even if the source ignores ctx.
func (f *Feed) fetchSnapshot() (*Snapshot, error) {
	ctx, cancel := context.WithTimeout(context.Background(), f.refreshTimeout)
	defer cancel()

	type sourceResult struct {
		rows []UpstreamVehicle
		err  error
	}
	sourceResults := make(chan sourceResult, 1) // buffered: a late source never blocks
	go func() {
		rows, err := f.source.Vehicles(ctx)
		f.markSourceFinished()
		sourceResults <- sourceResult{rows: rows, err: err}
	}()

	var fetched sourceResult
	select {
	case fetched = <-sourceResults:
	case <-ctx.Done():
		return nil, fmt.Errorf("Source.Vehicles [timeout=%s]: %w", f.refreshTimeout, ctx.Err())
	}
	if fetched.err != nil {
		return nil, fmt.Errorf("Source.Vehicles: %w", fetched.err)
	}

	vehicles, err := normalize(fetched.rows)
	if err != nil {
		return nil, fmt.Errorf("normalize: %w", err)
	}
	// check time after the fetch, at JS Date (millisecond) precision
	fetchedAt := f.now().UTC().Truncate(time.Millisecond)
	// only the single in-flight refresh reaches here, so the tracker needs no lock
	vehicles = f.directions.update(vehicles, fetchedAt)
	return &Snapshot{Vehicles: vehicles, FetchedAt: fetchedAt}, nil
}
