# Task: Faster browser tests

Status: in progress. Local runs have opt-in workers and GPU rendering; the rest is below.

## Goal and acceptance criteria

The full browser suite takes no more than 5 minutes locally, and CI selects as little as a change needs, without losing
the tests that have found real bugs: offline, updates, and editor exports through the real importer.

## Measured

All three suites, one worker with software rendering: about 25.5 minutes, and half of that repeats tests on the phone
layout. With `E2E_WORKERS=6 E2E_ANGLE=gl-egl`: 6.7 minutes on a 16-thread machine with an integrated AMD GPU, with no
failures or retries. On the viewer tests, the GPU alone saves about 15%, and workers do most of the rest. GitHub's
standard runners have no GPU and few CPUs, so CI keeps one worker for now.

## Remaining, in order

1. Run the phone layout only where it matters: touch, stacked layout, overflow, install and the URL prefix, plus one
   whole journey per app. This saves about 8 to 9 minutes of test time. It changes what is covered, so it needs its own
   review.
2. Split the editor suite into browser areas, as web has, so that CI runs them in parallel and selects them by what
   changed.
3. Move logic out of browser tests. Two `poi-visibility` tests take 40 to 50 seconds each to step through zoom
   thresholds, which a unit test plus one browser check can cover. Many `editing` tests can shrink the same way.
4. Replace the fixed waits in web's tests with waits on actual state.
5. Delete the sketch prototype and its 30 tests, now that the real editor exists.
6. Try more than one worker in CI, watching for the load-related timeouts seen under `act`.

## Handoff

Parallel load causes test timeouts at 15 seconds, and 90 seconds in the slowest web test, when many browser jobs share
one machine under `act`. Six workers on one host did not. Measure after each step.
