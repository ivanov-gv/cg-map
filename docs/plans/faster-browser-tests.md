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

## Remaining

- Many `editing` tests can move their logic into unit tests, as `poi-visibility` did. All three suites in sequence took
  5.8 minutes with `E2E_WORKERS=6 E2E_ANGLE=gl-egl` on 2026-11-07: web 3.0, editor 2.5.
- Six fixed waits stay in web's tests, on purpose. They time input rather than wait for state: the block after a camera
  move, the gap between wheel gestures, and the pace of a drag.
- The editor gains a quarter of its startup from the icon change in packages/map-core once it pins a release with it:
  1.25 to 0.92 seconds, unloaded, with software rendering. Web gains too.

## Handoff

Parallel load causes test timeouts at 15 seconds, and 90 seconds in the slowest web test, when many browser jobs share
one machine under `act`. Six workers on one host did not. Measure after each step.
