# Task: Faster browser tests

Status: in progress. CI jobs are split to fit the limit in
[ADR 0006](../decisions/0006-ci-time-limits-and-tests-before-merge.md), and local runs have opt-in workers and GPU
rendering. The rest is below.

## Goal and acceptance criteria

The full browser suite takes no more than 5 minutes locally, and CI selects as little as a change needs, without losing
the tests that have found real bugs: offline, updates, and editor exports through the real importer.

## Measured

All three suites, one worker with software rendering: about 25.5 minutes, and half of that repeats tests on the phone
layout. With `E2E_WORKERS=6 E2E_ANGLE=gl-egl`: 6.7 minutes on a 16-thread machine with an integrated AMD GPU, with no
failures or retries. On the viewer tests, the GPU alone saves about 15%, and workers do most of the rest. GitHub's
standard runners have no GPU and few CPUs. Web and editor browser jobs use 2 workers, and the editor suite runs as 6
jobs.

## Remaining, in order

1. Run the phone layout only where it matters: touch, stacked layout, overflow, install and the URL prefix, plus one
   whole journey per app. This saves about 8 to 9 minutes of test time. It changes what is covered, so it needs its own
   review.
2. Select the editor's browser jobs by what changed, as web's are. They run in parallel but always all run.
3. Move logic out of browser tests. Two `poi-visibility` tests take 40 to 50 seconds each to step through zoom
   thresholds, which a unit test plus one browser check can cover. Many `editing` tests can shrink the same way.
4. Replace the fixed waits in web's tests with waits on actual state.
5. Delete the sketch prototype and its 30 tests, now that the real editor exists.

## Handoff

Parallel load causes test timeouts at 15 seconds, and 90 seconds in the slowest web test, when many browser jobs share
one machine under `act`. Six workers on one host did not. Measure after each step.

## Open problem: editor update takeover

After Update, the browser sometimes keeps a waiting worker from activating, even with repeated requests, until every
window closes. It is more likely with several windows and under load. The editor says what to do and nothing is lost,
and the three-window test in `offline.spec.mjs` accepts this outcome and records which one occurred. The cause is not
diagnosed: the next step is finding what keeps the active worker busy, then making that test strict again.
