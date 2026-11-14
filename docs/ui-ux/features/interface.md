# Interface: laconic, stable, map first

Status: approved on 3 November 2026 and implemented in the web source. The earlier illustrative draft established the
composition; the application uses real directory data, device positioning, optional layers, and verified offline
downloads. This does not claim deployment or completion of Discover’s missing geographic data. Browser acceptance and
physical-device evidence are recorded separately below.

This document owns control layout, wording, and expansion behavior. [Discover](../user-stories/discover.md) owns the
geographic scene and honest location semantics; [Understand](../user-stories/understand.md) owns selected-object
details. [Plan](../user-stories/plan.md) covers journey preparation and route readiness;
[Travel](../user-stories/travel.md) covers live route-following and finishing. Preserve the capabilities in
[user stories](../user-stories/user-stories.md) while changing their presentation.

[Stable POI visibility](poi-visibility.md) retains these search controls and map focus while restricting below-threshold
display to one leading or selected result; other matching icons keep their assigned levels. This refines marker
admission, not the dock or mobile composition.

## User outcomes served

These controls exist to help people find a known place (US-02), discover nearby options (US-03), inspect and set journey
endpoints without losing them (US-04–06), compare the bounded imagery sample (US-10), prepare for offline use and
recover from failure (US-11–12), and understand current-position state (US-13). The requirements below constrain how
those tasks are presented; they are not extra goals detached from the story baseline.

| Interface area                  | Story basis     | User purpose                                                                                             |
| ------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------- |
| Opening view and location       | US-01, US-13    | Orient on the map and understand whether the displayed position is usable.                               |
| Search, results, dock           | US-02–04        | Find and inspect a relevant listing without losing context.                                              |
| Layer and download controls     | US-06, US-09–12 | Keep journey state while inspecting a layer, checking transport, or preparing/recovering offline access. |
| Honest states and accessibility | US-11–13        | Understand limits and recover without misleading status or inaccessible controls.                        |

## Intention

**Let me read the map immediately, then reveal useful controls where I already expect them to be.**

A laconic UI earns its space through an action, information needed for that action, or essential geographic context.
Visual quiet comes from removing redundant controls and wording, grouping related actions, and keeping their positions
stable. A short interface still needs understandable symbols, accessible names, truthful state, and recoverable errors.

- Make the map the principal content. Keep results and optional controls closed on opening.
- Prefer a recognizable pictogram with a short label to a heading, explanatory sentence, and separate control.
- Reveal optional controls through one flat dock. Mobile search started with the dock closed uses a compact results
  bubble so the map stays usable; desktop search remains inside the dock. Avoid menus within menus.
- Keep controls still. Opening, filtering, loading, and empty results must not rearrange unrelated actions.
- Remove slogans, obvious instructions, duplicate headings, and routine status prose. Show explanation when it helps
  someone resolve a specific failure or understand a selected object.

## UI-01 Opening view

Show the map, one combined burger/search bar, an icon-only location button, zoom controls, a metric scale, and required
attribution (placed in the left dock footer, per [ADR 0016](../../decisions/0016-map-attribution-in-the-left-dock.md)).
Default geographic content remains governed by Discover; simplifying controls does not remove roads, buildings,
addresses, terrain, or scale-appropriate places.

The dock starts closed. Do not show a result list, expanded map key, location text banner, download promotion, About
block, tagline, route panel, or dedicated Country overview / Return to Podgorica buttons. Pan and zoom retain access to
country and local context. Search categories and results appear after opening the dock or using search.

## UI-02 One header, expanding dock

The burger and search form one shared header. When closed, that header floats over the map. When open, the left dock
extends behind and below it, and the header belongs to the dock.

At a fixed viewport, both states MUST have identical header coordinates, width, height, padding, border, corner radius,
icon positions, and text baseline. Do not move the header beside the dock, replace it with another input, or turn its
rounded shape into a different toolbar. Preserve query, category, focus, and text selection through expansion.

Keep the dock attached to the left edge rather than presenting a floating bubble or bottom sheet. The same rule applies
on phones; viewport changes may adapt dimensions, but opening alone must not change header geometry. The burger toggles
the dock, with an accessible name and expanded state. Escape closes it and returns focus appropriately.

### Desktop search bar

On desktop (viewport ≥ 721 px), the search bar is 60 px tall. With no query and the dock closed, a row of floating
category chips appears under the bar; each chip floats with its own shadow, and the row scrolls horizontally when it
overflows. The chips reuse the same category state as the dock (one source of truth). Pressing a chip filters the map's
places, exactly as the dock categories do.

Typing a query shows a clear (×) button inside the bar at the right. Under the bar, a unified search panel appears,
joined to the bar as one card: the categories row, then a scrollable results list. The floating chips hide when the
panel appears. Escape clears a non-empty query, keeping the search field focused. Tab reaches the menu button, the
input, the clear button, and the category chips. The dock remains available via the burger for layer and download
controls.

On phones, activating search instead of the burger follows the compact-search behavior below. The shared header stays in
place in both modes; using search must not implicitly open the full dock.

## UI-03 Results scroll; options stay at the bottom

The full dock has three areas: the shared header, a flexible scrolling area for categories/results, and a bottom area
for optional layers and the offline action. Everything is accessible together without nested menus. The burger opens
this full dock on desktop and phone; desktop search also uses it, and so does phone search started with the dock open.

The bottom area's lower edge stays anchored to the dock bottom. Zero, one, or many matches, a loading state, and an
error must not move those options up or down. Results scroll independently when they exceed the available space. An
active download may need more room for progress/cancellation, but its lower edge remains anchored.

Retain all supported categories and directory/search semantics from the baseline. Choosing a result opens that place's
details beside the dock, and the dock and results stay open. Moving or closing the dock does not clear the query, select
route endpoints, or start a route. While a chosen place's details are open, the result list keeps its order. Choosing
From or To closes the dock or search, because the route controls replace them on the map. The category strip and the
place card show no scrollbars; both still scroll. In windows 721–860 px wide the card narrows to keep the map controls
reachable, leaving only a narrow strip of map.

The search field shows focus through its caret and a neutral change to the shared bar's border, not the generic focus
ring. Other controls keep the ring.

### Search moves the map only for a chosen place

Opening search, typing, and choosing a category leave the camera still. Choosing a result or map pin moves the map only
if that place is outside the focus zone: the inner 75% of the width and height of the map area no panel covers. A place
outside the zone is centered in the uncovered area. Below street level (zoom 15), a chosen result also zooms in to it,
because a pin with no streets around it is not useful. A tap on another map object, such as a building or stop, still
centers that object. The camera also stays still while the phone keyboard is open; the place is checked again once it
closes.

Omit the result count, “nearest first” caption, and Reset action. Tapping the active category again returns to Explore
all without clearing the query; the search field's own clear action removes the query. Use readable result rows with
16px names and at least 76px height.

### Mobile search keeps the map visible

At the phone layout (the 720px breakpoint), focusing or typing in search with the dock closed opens a results bubble
beneath the unchanged header. With the dock open, search stays in the dock and shows its results there, without the
options while the keyboard is open. With the dock closed, keep it and its layer/download options closed. Categories stay
fixed at the top; only the result list below them scrolls. The category strip may scroll horizontally to reach all
supported categories. Size the bubble to fill the space beneath the header down to the midpoint of the available visible
viewport, even for a short result list. The upper half contains search; the lower half remains map. Use the viewport
remaining above the on-screen keyboard when calculating that limit, not the obscured layout height.

Keep the map visible and interactive without a blocking scrim. Show matching places on the map using the same identities
as the result list, and highlight the selected result or, before selection, the nearest match. Do not relocate the
geographic marker. A chosen place must not stay hidden under the search UI, keyboard, or card. More distant matches may
require choosing a result rather than forcing every marker into one tiny view. An empty search result must not create a
fictitious marker.

Choosing a result keeps the results open and shows the place card minimized at the bottom of the visible screen, showing
only its header. Dragging or scrolling the card up, or activating its header, opens the full card and shrinks the
results to one strip under the search bar. The strip names the active query or category and brings the list back.
Swiping down from the full card returns to the minimized card with the results; swiping down from the minimized card
closes it. A card with no search behind it, such as one opened from a map object, closes on one swipe. The phone card
has no visible close button; one remains for screen readers. A card long enough to scroll keeps vertical swipes on its
body for scrolling, so it is swiped from its header.

The burger explicitly opens the existing full dock, retaining the query and category. Focusing or typing in search keeps
the dock open. Choosing a result switches from the dock to the compact view, with the same minimized card and results
and the query and category kept. Result selection and keyboard dismissal must keep the relevant place visible. This is a
mobile search exception to the dock composition, not a replacement of the burger menu with a bottom sheet. The category
strip has no scrollbar: it scrolls by touch or mouse wheel and brings the active category into view.

## UI-04 Bottom controls and wording

| Control          | Presentation                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| Satellite        | Optional layer tile with a recognizable pictogram and the short label **Satellite** underneath. |
| Transport        | Optional layer tile with a recognizable pictogram and the short label **Transport** underneath. |
| Offline download | One button labeled **Download for offline use** before a download starts.                       |

Arrange the layer tiles in a compact grid, not a vertical settings list. Omit the Standard map option and the visible
headings Map layers and Offline map. Each tile exposes its active/available state; optional layers start off. Turning
off satellite returns to the regular map without needing a separate Standard map control.

The download action must retain real progress, cancellation, saved/unavailable/error states, and existing download
safety. Its wording may change to describe those states. Do not add generic copy such as “Save once. Explore without a
connection,” a tutorial paragraph, or a Help/Map key block to fill unused dock space.

## UI-05 Honest state with minimal interruption

The location control uses a small icon with non-color state differences and an accessible name/state. It must
distinguish acquisition, a usable fix, approximate/stale data, and unavailable positioning without a persistent text
banner. The position marker and uncertainty remain truthful under
[Discover D-06](../user-stories/discover.md#d-06-current-position-and-honest-uncertainty).

With a usable fix, activating location recenters immediately; it does not first open a “Your location” explanation or
details panel. Without a usable fix, request/retry positioning where possible, or give concise actionable recovery after
the request fails. Never move to a fabricated position or call the fallback camera the user's location.

Minimal wording does not remove required attribution, sourced facts in object details, permission handling, coverage
limits, or action-specific failures. Keep those explanations attached to the relevant feature/action. Do not replace
readable labels with unexplained pictograms or rely on color, hover, or a tooltip alone for essential state. Follow the
[UI accessibility guidelines](../../engineering/ui.md) for names, focus, touch targets, and reduced motion.

## Acceptance

| ID     | Check                                                                                                                                  | Pass condition                                                                                                                                                                                                                                                                     |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-A01 | Open with no app interaction.                                                                                                          | Only the opening controls and geographic scene are present; dock content is closed.                                                                                                                                                                                                |
| UI-A02 | Toggle the dock at an unchanged viewport.                                                                                              | Header/control bounding boxes, shape, and text baseline remain unchanged; query, category, focus, and selection survive.                                                                                                                                                           |
| UI-A03 | Search for zero, one, and many places; scroll results; include loading/failure.                                                        | Categories remain fixed while the result list scrolls. Full-dock bottom options stay anchored; mobile search is capped and leaves the map visible.                                                                                                                                 |
| UI-A04 | Inspect bottom options.                                                                                                                | Two labeled pictogram tiles and the download action; no Standard map option, redundant headings, nested menus, or generic prose.                                                                                                                                                   |
| UI-A05 | Activate location with a fresh fix, then test unavailable positioning.                                                                 | A usable fix recenters directly; unavailable positioning follows the recovery path without inventing a location.                                                                                                                                                                   |
| UI-A06 | Toggle layers and start/cancel/fail a download.                                                                                        | Actual state is clear at its control; optional failures preserve browsing and an existing verified download.                                                                                                                                                                       |
| UI-A07 | Use keyboard, screen reader, and touch.                                                                                                | Controls have names/states, visible focus and adequate targets; closing restores focus without reopening the dock.                                                                                                                                                                 |
| UI-A08 | Repeat on desktop, 412×840 phone, around the 720px breakpoint, and short landscape views.                                              | Stable header and bottom controls; results remain reachable, with no clipping or overlapping controls.                                                                                                                                                                             |
| UI-A09 | On a phone, focus search, type, select different results, and open/dismiss the keyboard; then use the burger and search from the dock. | Search started with the dock closed leaves it closed, the bubble is at most half the visible viewport, and a selected marker stays uncovered once the keyboard is dismissed. Burger opens the full dock with query/category retained; search stays in it until a result is chosen. |
| UI-A10 | Open search, type, and choose categories; then choose results inside and outside the focus zone.                                       | Only choosing a place outside the inner 75% of the uncovered map moves the camera, unless it must zoom in to street level. The result list does not reorder while the card is open.                                                                                                |
| UI-A11 | On a phone, choose a result, swipe the card up and down, use the strip, and swipe it closed.                                           | Results and minimized card share the screen; the full card reduces results to the strip; swiping steps back and closes. Closing leaves results open and the camera still; other steps move it only if the place leaves the zone.                                                   |
| UI-A12 | On desktop, choose a result and close its card.                                                                                        | Dock, results, and card are visible together without overlap; closing returns focus to the row and leaves the dock open.                                                                                                                                                           |

Automated coverage in [the web browser suite](../../../apps/web/tests/e2e/interface.spec.mjs) checks initial chrome,
unchanged header geometry, anchored options, fixed categories over scrolling results, query preservation, projected
selection visibility, the still camera during search, the focus zone, phone card swipes with simulated touch, and
desktop card and dock coexistence. Keyboard geometry is simulated with a smaller visual viewport; this does not
establish physical keyboard, screen-reader, or phone behavior. Review physical-device usability under
[the testing guide](../../verification/testing.md). Keep scale/POI stability checks in
[Discover D-05](../user-stories/discover.md#d-05-points-of-interest-without-clutter); the illustrative draft's
cumulative icons do not prove a production placement solution. Paid visibility is outside this UI decision.

## Reusable initial brief

> Create a small, self-contained HTML draft of a laconic, map-first interface for Kompas. Let the person explore the map
> immediately. On opening, show only a combined burger/search bar, an icon-only locate button, zoom, scale, and required
> attribution (in the left dock footer, per [ADR 0016](../../decisions/0016-map-attribution-in-the-left-dock.md)). Keep
> the dock closed.
>
> Opening the burger expands a left dock around the existing header. Desktop search uses that dock too. Keep the burger
> and search at exactly the same coordinates, dimensions, and shape across states; preserve typing and focus. Dock
> results scroll; options stay anchored at the bottom regardless of result count. Omit the count, “nearest first,” and
> Reset row. Tapping the active category again removes that category filter.
>
> On phones, search opens a results bubble instead of the full dock. Fill the area below the header down to the visible
> screen's midpoint, accounting for the keyboard, with readable result rows. Keep categories fixed above the scrolling
> result list. Keep the map interactive and a selected marker visible outside the bubble. Searching does not move the
> map; choosing a place moves it only if the place is outside the inner 75% of the uncovered map. Choosing a result
> keeps the results open above a minimized place card; pulling the card up shrinks the results to one strip, and swiping
> down steps back and then closes the card. The burger still opens the full dock with the current query and category;
> search stays there until a result is chosen, which switches to this compact view.
>
> At the bottom, show two pictogram tiles with small labels underneath: Satellite and Transport. Below them, put a
> button labeled “Download for offline use.” No Standard map option, section headings, nested menus, desktop result
> bubbles, slogans, explanatory filler, persistent legend/location banner, or dedicated country/default-city shortcuts.
>
> The location button recenters directly on a usable position. Keep meaningful states, recovery, accessible names,
> keyboard focus, and touch targets. Use an illustrative map for this draft; do not add backend services or claim real
> positioning, layers, or downloads. Make the same composition work on desktop and phone.
