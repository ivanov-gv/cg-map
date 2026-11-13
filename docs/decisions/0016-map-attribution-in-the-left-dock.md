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

The floating control is disabled by passing `attributionControl: false` in `apps/web/src/app.js` to `createMap`. The
`packages/map-core` package is not modified; the option override is sufficient because `createMap` spreads `options`
last.

The attribution module (`apps/web/src/attribution.js`) reads the attribution strings from the map's style object at
runtime via `map.getStyle()`. It collects the `attribution` field from every source that has at least one visible layer,
deduplicates them, and renders the result into `#map-attribution` after sanitising the HTML. No hard-coded copies of the
strings exist in the module; if a source's attribution changes in map-core, the display updates automatically.

## Alternatives considered

- Keep the compact MapLibre control. Rejected: the wiki spec removes it.
- Place a static credit beside the scale bar. Rejected for now: it is still a floating sign on the map.
- Remove attribution entirely. Rejected: it would violate the licence.

## Consequences

- The map surface no longer shows a floating attribution control on any viewport (Desktop, Mobile, or Flip).
- Attribution remains one tap away: the user opens the dock menu to see it. The map surface no longer names its data
  source. A user sees the credit only after opening the menu, which is weaker than the on-map attribution the OSMF
  guideline prefers. This was accepted because the wiki spec, the product's source of truth, removes the floating sign.
  If the owner or the OSMF guideline requires on-map attribution, the fallback is MapLibre's compact control or a small
  static credit by the scale bar.
- The attribution updates when satellite is toggled on/off, showing both source credits when applicable.
- The `packages/map-core` package remains unchanged; the change is isolated to `apps/web`.
- If new map sources are added in the future, their attribution appears automatically; no change to the attribution
  module is needed.
