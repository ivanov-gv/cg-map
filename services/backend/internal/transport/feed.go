package transport

import (
	"context"
	"fmt"
	"log"
	"sync"
	"time"
)

// feed caches the last normalized snapshot with relay.mjs semantics: a 13s fresh window,
// one shared in-flight refresh, and stale snapshots served for at most 60s after a failure.
type feed struct {
	source         Source
	now            func() time.Time
	refreshTimeout time.Duration

	mu      sync.Mutex
	cached  *snapshot
	pending *refreshCall
	// sourceRunning stays true until Source.Vehicles returns, even after a refresh timed out,
	// so a source that ignores ctx never has more than one call outstanding.
	sourceRunning bool

	// directions is used only inside fetch, which runs for one refresh at a time
	directions directionTracker

	// logf reports upstream failures (rate-limited) and recoveries; guarded by mu
	logf          func(format string, args ...any)
	failing       bool
	lastFailLog   time.Time
	suppressedLog int
}

// refreshCall is one in-flight upstream refresh shared by every concurrent request.
type refreshCall struct {
	done   chan struct{} // closed once result/err are set
	result *snapshot
	err    error
}

func newFeed(source Source, now func() time.Time) *feed {
	return &feed{source: source, now: now, refreshTimeout: defaultRefreshTimeout, logf: log.Printf}
}

// Current returns a fresh snapshot, a refreshed one, or a stale one (Stale: true) within 60s of
// its check time. Otherwise it returns the 503 body together with an error wrapping ErrUnavailable.
func (f *feed) Current(ctx context.Context) (FeatureCollection, error) {
	f.mu.Lock()
	// serve the fresh cache without touching the source
	if f.cached != nil && f.now().Sub(f.cached.fetchedAt) < cacheTTL {
		cached := f.cached
		f.mu.Unlock()
		return cached.collection(false), nil
	}
	// join the in-flight refresh or start one, unless an abandoned source call is still running
	call := f.pending
	if call == nil {
		if f.sourceRunning {
			f.mu.Unlock()
			return f.fallback(ErrSourceBusy)
		}
		call = &refreshCall{done: make(chan struct{})}
		f.pending = call
		f.sourceRunning = true
		go f.refresh(call)
	}
	f.mu.Unlock()

	// wait without letting one caller's cancellation affect the shared refresh
	select {
	case <-call.done:
	case <-ctx.Done():
		return unavailableCollection(), fmt.Errorf("feed.Current: %w: %w", ErrUnavailable, ctx.Err())
	}
	if call.err == nil {
		return call.result.collection(false), nil
	}
	return f.fallback(call.err)
}

// fallback serves the previous snapshot as stale while it is at most 60s old, otherwise the 503 body.
func (f *feed) fallback(cause error) (FeatureCollection, error) {
	f.mu.Lock()
	cached := f.cached
	expired := cached == nil || f.now().Sub(cached.fetchedAt) > maxStaleAge
	f.mu.Unlock()
	if expired {
		return unavailableCollection(), fmt.Errorf("feed.Current: %w: %w", ErrUnavailable, cause)
	}
	return cached.collection(true), nil
}

// reportLocked logs the first failure, then at most one per failureLogInterval with a count of the
// others, and the recovery. Without it an upstream change shows only as 503s or stale data.
func (f *feed) reportLocked(err error) {
	now := f.now()
	if err == nil {
		if f.failing {
			f.logf("transport: vehicle feed recovered")
		}
		f.failing, f.suppressedLog = false, 0
		return
	}
	if f.failing && now.Sub(f.lastFailLog) < failureLogInterval {
		f.suppressedLog++
		return
	}
	f.logf("transport: vehicle refresh failed (%d more failures since last report): %v", f.suppressedLog, err)
	f.failing, f.lastFailLog, f.suppressedLog = true, now, 0
}

// refresh fetches and normalizes one upstream snapshot, then publishes it to call's waiters.
func (f *feed) refresh(call *refreshCall) {
	result, err := f.fetch()

	// publish before releasing waiters, so a later request sees the new cache
	f.mu.Lock()
	if err == nil {
		f.cached = result
	}
	f.reportLocked(err)
	f.pending = nil
	call.result, call.err = result, err
	f.mu.Unlock()
	close(call.done)
}

// fetch reads the source with a hard timeout, even if the source ignores ctx.
func (f *feed) fetch() (*snapshot, error) {
	ctx, cancel := context.WithTimeout(context.Background(), f.refreshTimeout)
	defer cancel()

	type sourceResult struct {
		rows []Vehicle
		err  error
	}
	results := make(chan sourceResult, 1) // buffered: a late source never blocks
	go func() {
		rows, err := f.source.Vehicles(ctx)
		// allow the next source call only once this one has returned
		f.mu.Lock()
		f.sourceRunning = false
		f.mu.Unlock()
		results <- sourceResult{rows: rows, err: err}
	}()

	var fetched sourceResult
	select {
	case fetched = <-results:
	case <-ctx.Done():
		return nil, fmt.Errorf("Source.Vehicles [timeout=%s]: %w", f.refreshTimeout, ctx.Err())
	}
	if fetched.err != nil {
		return nil, fmt.Errorf("Source.Vehicles: %w", fetched.err)
	}

	features, err := Normalize(fetched.rows)
	if err != nil {
		return nil, fmt.Errorf("Normalize: %w", err)
	}
	// check time after the fetch, at JS Date (millisecond) precision
	fetchedAt := f.now().UTC().Truncate(time.Millisecond)
	// only the single in-flight refresh reaches here, so the tracker needs no lock
	features = f.directions.update(features, fetchedAt)
	return &snapshot{features: features, fetchedAt: fetchedAt}, nil
}
