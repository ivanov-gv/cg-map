# 0015: MapLibre gestures unchanged

Supersedes [ADR 0014](0014-deterministic-wheel-zoom.md).

## Status

Accepted.

## Context

Issue #77 reported that zoom speed in the public app sometimes jumped. Nobody asked which device was in use, and its
input was never recorded. The diagnosis came from reading MapLibre's source: MapLibre guesses mouse or trackpad from
event timing, and a mouse labelled as a trackpad zooms about four times faster. The issue was retitled as a mouse-wheel
bug, and #78 replaced MapLibre's scroll zoom with an app handler (ADR 0014). Its tests sent synthetic 120 px notches
built from that hypothesis, so they could only confirm it. They passed, and the change merged without anyone trying it
on a real device.

The reporter was on a Linux Chrome touchpad. There the handler ran away to the zoom limit (#79). Two more fixes, each
still derived from reasoning, gave a lag and then a jump at the end of a swipe, and then stutter. Progress came from
recording the reporter's real wheel events, about twenty seconds of work, and then serving stock MapLibre for the
reporter to try. The reporter found stock MapLibre right on the laptop touchpad and on a phone. Replaying the recording
showed that stock MapLibre zooms a slight swipe about 1.9 levels, so the speed that "felt right" was MapLibre's trackpad
rate, not the slower rate the later fixes assumed. The original #77 spike was never reproduced, and its cause is
unknown.

## Decision

The public app uses MapLibre's gesture handlers unchanged: scroll and touchpad zoom, pinch, double tap, tap-drag zoom,
drag pan and keyboard. apps/web has no wheel-zoom module and does not set scroll zoom rates. App code may still move the
camera with `easeTo` for its own framing. map-taps.js may delay tap selection but must not change zoom.

A change to how a gesture feels needs the following, in order: real input recorded on the reporter's device, a
comparison with MapLibre's defaults and public options, and the reporter's check on a local or LAN dev server before the
PR. The rule is in [UI conventions](../engineering/ui.md#interaction-and-accessibility).

## Consequences

Gesture behavior follows MapLibre upgrades and its tuning across real hardware, and the app owns no input heuristics.
MapLibre's timing guess remains, so the #77 spike may come back. If it does, record the events at that moment before
changing anything. Fixing a gesture bug is slower, because it needs the reporter's device and time.
