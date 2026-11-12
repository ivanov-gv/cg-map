# 0014: Deterministic wheel zoom

## Status

Accepted.

## Context

Issue #77: mouse-wheel zoom in the public app sometimes became about four times faster. MapLibre's scroll zoom decides
on the second event of a gesture whether the input is a mouse or a trackpad. It picks trackpad when the time since the
previous event multiplied by the delta is below 200. Browsers dispatch wheel events per animation frame, so under
main-thread load two mouse notches arrive 0–1 ms apart. The mouse then gets the trackpad rate until a 400 ms pause.
MapLibre 5.24 still has this behavior, and MapLibre offers no public way to change how it classifies the device.

## Decision

apps/web disables `map.scrollZoom` and installs its own wheel zoom from `apps/web/src/wheel-zoom.js`. A gesture's device
is chosen from the values of its first non-zero event: delta mode, ctrl (pinch), MapLibre's macOS notch quantum, and a
50 px threshold. Time only marks gesture boundaries. The rates and the curve are MapLibre's. Every ease shares one
`easeId` and is `essential`, so one gesture is one camera move that carries the wheel event as `originalEvent`.

## Consequences

Zoom speed no longer depends on timing, and tests can check it. The app now owns behavior it used to get from MapLibre
for free, so a MapLibre upgrade must recheck `easeId` chaining and the `essential` option. A high-resolution mouse that
reports small pixel deltas gets the trackpad rate, consistently, as it already did in MapLibre. apps/editor and
apps/core-demo still use MapLibre scroll zoom; moving this module into packages/map-core would need a map-core release.

