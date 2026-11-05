package vehicles

import (
	"fmt"
	"time"
)

// failureReporter decides what to log about refreshes: the first failure, then at most one per
// failureLogInterval with a count of the others, and the recovery. Without it an upstream change
// shows only as 503s or stale data. It is not safe for concurrent use; the feed calls recordOutcome under
// its mutex and writes the returned line after releasing it, so a blocked log cannot stall readers.
type failureReporter struct {
	isFailing       bool
	lastLogAt       time.Time
	suppressedCount int
}

// recordOutcome records the outcome of one refresh, where a nil err is a success, and returns the line to
// log, or "" for none.
func (r *failureReporter) recordOutcome(err error, now time.Time) string {
	if err == nil {
		wasFailing := r.isFailing
		r.isFailing, r.suppressedCount = false, 0
		if wasFailing {
			return "vehicles: feed recovered"
		}
		return ""
	}
	if r.isFailing && now.Sub(r.lastLogAt) < failureLogInterval {
		r.suppressedCount++
		return ""
	}
	line := fmt.Sprintf("vehicles: refresh failed (%d more failures since last report): %v", r.suppressedCount, err)
	r.isFailing, r.lastLogAt, r.suppressedCount = true, now, 0
	return line
}
