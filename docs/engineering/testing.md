# Tests: is this one needed?

Applies to every test in every project: unit, integration, built-artifact and browser tests. A test costs compute on
every run, forever, and time on every change that touches what it checks. It earns that cost only by catching a real
regression that no other test catches. Readability and the language guidelines still apply.

## Before adding a test, answer all five

1. **Which bug does it catch?** Name a plausible change to the code under test that makes this test fail. If you cannot
   name one, do not add it.
2. **Does another test already catch that bug?** Search the project's tests for the same behaviour. If one exists,
   extend it or add a case to it; do not add a second test.
3. **Is this the cheapest layer that can catch it?** Logic without a browser (state machines, parsers, formatters,
   filters, sorting, URL and attribute handling) is a unit test, in milliseconds. A browser test only checks what needs
   a real browser: layout that depends on CSS, input events, map rendering, the service worker, navigation and history.
   In an app or map-core the [file name](javascript.md#tests) says which layer a test belongs to.
4. **Does it test our code?** Not the browser, MapLibre, Playwright, Node or a library, and not the test's own helpers.
5. **Will it break only when behaviour breaks?** It must not depend on data contents another project owns (use a
   [pinned version](../system-architecture/architecture.md#build-and-runtime-flow) or the project's own fixtures), on
   timing, or on incidental details such as exact pixel positions.

## Never multiply a test for nothing

- **One behaviour, one test.** Do not write a test per state combination when one journey covers them in order.
- **A device or viewport case only where the behaviour differs.** Playwright projects already run each test at their
  viewport. Do not also loop over devices inside a test file: every looped case runs again in every project. Pick one
  mechanism, and add a device only when the code takes a different path on it.
- **A parameter only where the code path differs.** One representative per equivalence class, plus its boundaries.
  Values that run the same branch add time, not coverage.
- **Merge near-duplicates.** Tests whose titles differ only by the screen state ("stays bottom-left with the card",
  "…with the dock", "…with search open") are one parametrised test, or one journey with several assertions.

## Not tests

- **Appearance:** sizes, paddings, radii, colours, shadows and icon artwork are judged by a design review or a manual
  check. Assert a measurement only when a written rule requires it, such as 40 px touch targets or no sideways scroll.
- **Absence of removed code:** a test that an element, file or option deleted long ago still does not exist. Delete the
  code; the review catches its return.
- **Visual review tools:** screenshots for a human to look at belong in a tool or a script, not in a skipped test.
- **Proofs of a helper:** a test that injects a fault only to show that the test helper notices it.

## Removing a redundant test

The hard rule "never delete, skip or loosen a failing test for green output" protects coverage, not test count. A
passing test may be removed or merged when its change shows the coverage stays: make a change that the removed test
caught, and show that a remaining test fails on it. Write the proof in the PR. Never remove a failing test.

## In review

The compliance review asks the five questions for every test a change adds and names the multiplication it finds. A PR
that adds browser tests states how many runs they add across all projects.
