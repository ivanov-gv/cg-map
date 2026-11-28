# 0016: Map attribution in the left dock

## Status

Accepted.

## Context

The wiki spec for the web app UI (source of truth) calls for no floating attribution control on the map. MapLibre's
default `attributionControl` renders a floating panel in the bottom-right corner, which conflicts with the spec's
clean-map requirement.

At the same time, the OpenStreetMap data licence (ODbL) and the OpenStreetMap Foundation's attribution guideline ask for
attribution that a map user can find. This repository's UI rule (docs/engineering/ui.md) asks for it wherever the data
is displayed. The basemap source carries "© OpenStreetMap contributors · ODbL · Natural Earth" and the satellite source
carries "Imagery: eMapa · Ortofoto 2025". Removing attribution entirely would violate the licence.

## Decision

Move the attribution from the floating MapLibre control to the left dock footer (`#map-attribution` inside
`.dock-footer`). The attribution is rendered as a single muted line below the download controls, using `createElement`
(no `innerHTML` with untrusted input). It links to the OSM copyright page and, when satellite is visible, to the eMapa
source.

In addition, a small on-map credit line appears below the scale bar in the bottom-left corner: an "OpenStreetMap" link
to the OSM copyright page. It is implemented as a MapLibre `IControl` added in `apps/web/src/app.js` (not in
`packages/map-core`). The credit matches the scale bar's background, font, and colour, with half the scale bar's height.
This satisfies the wiki spec's requirement for an on-map OSM credit while keeping the full attribution (including
satellite credits) in the dock footer.

The floating control is disabled by passing `attributionControl: false` in `apps/web/src/app.js` to `createMap`. The
`packages/map-core` package is not modified; the option override is sufficient because `createMap` spreads `options`
last.

The attribution module (`apps/web/src/map/attribution.js`) reads the attribution strings from the map's style object at
runtime via `map.getStyle()`. It collects the `attribution` field from every source that has at least one visible layer,
deduplicates them, and renders the result into `#map-attribution` after sanitising the HTML. No hard-coded copies of the
strings exist in the module; if a source's attribution changes in map-core, the display updates automatically.

## Alternatives considered

- Keep the compact MapLibre control. Rejected: the wiki spec removes it.
- Place a static credit beside the scale bar. Initially rejected as a floating sign, but later accepted (PR #124) as a
  small on-map "OpenStreetMap" credit below the scale bar, matching the wiki spec.
- Remove attribution entirely. Rejected: it would violate the licence.

## Consequences

- The map surface shows a small "OpenStreetMap" credit link below the scale bar on every viewport (Desktop, Mobile, and
  Flip), matching the wiki spec.
- Full attribution (including satellite credits) remains in the left dock footer. The user opens the dock menu to see
  it.
- The on-map credit improves compliance with the OSMF guideline, which prefers visible on-map attribution.
- The attribution updates when satellite is toggled on/off, showing both source credits when applicable.
- The `packages/map-core` package remains unchanged; the change is isolated to `apps/web`.
- If new map sources are added in the future, their attribution appears automatically in the dock; no change to the
  attribution module is needed.
