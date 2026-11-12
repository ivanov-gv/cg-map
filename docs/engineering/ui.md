# UI conventions

Applies to browser apps under apps/web, apps/editor and apps/core-demo, plus DOM-facing map-core modules. Component
boundaries and offline invariants are in [apps/web/AGENTS.md](../../apps/web/AGENTS.md); language rules are in
[javascript.md](javascript.md).

## Layout and hosting

- The same artifact must work at `/` and `/cg-map/`. Use relative URLs for every asset, fetch, and service-worker scope.
  Enforced: Playwright `root-desktop` and `pages-mobile` projects.
- Phones are a primary target. Check the 720px breakpoint and a 412×840 touch viewport; keep touch targets at least
  40px.
- One MapLibre map instance per page. Add layers and sources to it rather than creating new maps.

## Styling

- Reuse the custom properties in style.css (`--green`, `--muted`, `--line`) and existing component classes before adding
  new colors or one-off styles.
- Keep visible keyboard focus (`:focus-visible`) and respect `prefers-reduced-motion`.
- Use `[hidden]` for show/hide; do not toggle inline `display` styles.

## Interaction and accessibility

- Use native elements: `<button>` for actions, `<a>` for navigation, form controls for input. Toggle buttons expose
  state with `aria-pressed`; icon-only controls need an accessible name.
- Loading, empty, stale, offline, and error states are part of the feature. Every async action needs a visible state for
  each.
- Show attribution and source notes required by [data licensing](../map-data/data-license.md) wherever the data is
  displayed.
- Map gestures (wheel and touchpad zoom, pinch, tap-drag, pan) are MapLibre's own; do not replace its handlers. For a
  bug in how input feels, record real events on the reporter's device and compare MapLibre's defaults before changing
  code; tests built from a hypothesis only confirm it. The reporter checks the fix on a dev server (LAN for phones)
  before the PR. Why: [ADR 0015](../decisions/0015-maplibre-gestures-unchanged.md).

## Verification

- `make -C <app> e2e` for any user-visible change. Add a Playwright assertion for new interactions.
- Do a manual check through `make -C apps/web dev` for visual changes and report what was checked; e2e does not judge
  appearance.
