package vehicles

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"
)

// Observer keeps a Feed refreshed in the background, so movement directions are known before a
// viewer arrives. Both APIs read through it and so share one set of upstream requests.
type Observer struct {
	feed               *Feed
	pollInterval       time.Duration
	startOnce          sync.Once
	isAwaitingMovement atomic.Bool
	stopped            chan struct{}
}

// NewObserver returns an observer of feed that checks the cache every pollInterval.
func NewObserver(feed *Feed, pollInterval time.Duration) *Observer {
	return &Observer{feed: feed, pollInterval: pollInterval, stopped: make(chan struct{})}
}

// Ready reports whether initial observation is complete. Without Start (live transport disabled),
// Current keeps the feed's normal on-demand behavior.
func (o *Observer) Ready() bool {
	return !o.isAwaitingMovement.Load()
}

// Current returns the feed's snapshot, or an error wrapping ErrUnavailable until observation
// completes, instead of a snapshot without directions.
func (o *Observer) Current(ctx context.Context) (Snapshot, error) {
	if !o.Ready() {
		return Snapshot{}, fmt.Errorf("Observer.Current [awaiting movement]: %w", ErrUnavailable)
	}
	return o.feed.Current(ctx)
}

// Start begins background observation without delaying the HTTP listener. Call it before serving.
// Feed failures are logged by the feed and retried; readiness stays false until observation succeeds.
// Repeated calls share the same worker. The returned channel closes when cancellation stops it.
func (o *Observer) Start(ctx context.Context) <-chan struct{} {
	o.startOnce.Do(func() {
		o.isAwaitingMovement.Store(true)
		go func() {
			defer close(o.stopped)
			o.observe(ctx)
		}()
	})
	return o.stopped
}

// observe retries observeUntilMovementKnown until it succeeds, marks the observer ready, then polls until cancellation.
func (o *Observer) observe(ctx context.Context) {
	retryTicker := time.NewTicker(o.pollInterval)
	defer retryTicker.Stop()
	for {
		err := o.observeUntilMovementKnown(ctx)
		if err == nil {
			o.isAwaitingMovement.Store(false)
			o.poll(ctx)
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-retryTicker.C:
		}
	}
}

// observeUntilMovementKnown observes two fresh snapshots so the first successful response can carry movement directions.
// It respects the shared cache period and stops on cancellation or feed failure.
// A stationary or newly seen vehicle still has no known direction.
func (o *Observer) observeUntilMovementKnown(ctx context.Context) error {
	err := ctx.Err()
	if err != nil {
		return fmt.Errorf("observeUntilMovementKnown: %w", err)
	}
	firstSnapshot, err := o.feed.Current(ctx)
	if err != nil {
		return fmt.Errorf("observeUntilMovementKnown [first snapshot]: %w", err)
	}
	if firstSnapshot.Stale {
		return fmt.Errorf("observeUntilMovementKnown [first snapshot stale]: %w", ErrUnavailable)
	}

	pollTicker := time.NewTicker(o.pollInterval)
	defer pollTicker.Stop()
	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("observeUntilMovementKnown: %w", ctx.Err())
		case <-pollTicker.C:
		}
		nextSnapshot, err := o.feed.Current(ctx)
		if err != nil {
			return fmt.Errorf("observeUntilMovementKnown [next snapshot]: %w", err)
		}
		if nextSnapshot.Stale {
			return fmt.Errorf("observeUntilMovementKnown [next snapshot stale]: %w", ErrUnavailable)
		}
		if !nextSnapshot.FetchedAt.Equal(firstSnapshot.FetchedAt) {
			return nil
		}
	}
}

// poll keeps the feed current until ctx is done: it refreshes whenever the 13 s cache expires. The
// feed limits the upstream to one request per cache period, the rate of a single ePodgorica map
// viewer. Viewer requests share the same refreshes.
func (o *Observer) poll(ctx context.Context) {
	pollTicker := time.NewTicker(o.pollInterval)
	defer pollTicker.Stop()
	for {
		// failures are logged by the feed and reported to viewers as stale/503
		if ctx.Err() != nil {
			return
		}
		_, _ = o.feed.Current(ctx)
		select {
		case <-ctx.Done():
			return
		case <-pollTicker.C:
		}
	}
}
