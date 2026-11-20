# Interface: laconic, stable, map first

Status: approved on 3 November 2026 and implemented in the web source. The earlier illustrative draft established the
composition; the application uses real directory data, device positioning, optional layers, and verified offline
downloads. Selected-card content was restructured on 19 November 2026 (issue #249); on 20 November 2026 the Desktop card
became a bottom panel (issue #250), while Mobile and Flip kept their geometry and state machines. This does not claim
deployment or completion of Discover’s missing geographic data. Browser acceptance and physical-device evidence are
recorded separately below.

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

Show the map, one combined burger/search bar, an icon-only location button, a metric scale, a small "OpenStreetMap"
credit below the scale bar, and full attribution in the left dock footer (per
[ADR 0016](../../decisions/0016-map-attribution-in-the-left-dock.md)). Current behavior: the scale bar and its credit
keep one position, the map's bottom-left corner, on every device and in every card, search, dock and keyboard state.
They are part of the map, so a card, search panel or Left Dock drawn over that corner covers them; only the Locate
button rises above a Desktop card. Default geographic content remains governed by Discover; simplifying controls does
not remove roads, buildings, addresses, terrain, or scale-appropriate places.

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
on phones; viewport changes may adapt dimensions, but opening alone must not change the outer header geometry. The
burger toggles the dock, with an accessible name and expanded state. Escape closes it and returns focus appropriately.

### Search bar states

The same three states apply on every device:

| State  | Bar                    | Results                                          |
| ------ | ---------------------- | ------------------------------------------------ |
| Empty  | Placeholder only, no × | Closed; the map is unobstructed.                 |
| Open   | Placeholder and ×      | Nearby list, nearest first, shown with no query. |
| Filled | Query and ×            | Results for the query and the active category.   |

The × keeps its box in the bar in every state. Where a state shows no ×, the button is hidden from sight and from the
accessibility tree, so the input's box never changes when it appears.

On Desktop and Mobile, × acts on state, not just on text. In Filled it clears the query and keeps the results open,
leaving the bar Open. In Open it closes the results and the place card and returns to the map, leaving the bar Empty.
With the dock open, the same sequence applies: Filled → Open keeps the dock and its results; Open → Empty closes the
dock and the card. Focus and query survive opening and closing the dock. Flip is the documented exception: Open shows no
×, and Filled × clears only the query; its Icon Button owns dock closing.

### Desktop search bar

On desktop (viewport ≥ 721 px), the search bar is 60 px tall. With no query and the dock closed, a row of floating
category chips appears under the bar; each chip floats with its own shadow, and the row scrolls horizontally when it
overflows. Focusing the field opens the joined Search panel even with no query: the row becomes categories above a
scrollable results list under the bar, as one card, and × appears at the right of the bar. Typing keeps the panel open
in Filled. The chips are the same row as the dock categories, not a second row: opening the dock keeps its horizontal
scroll position and active chip, and query and focus stay with the field. Pressing a chip filters the map's places and
reveals the results, exactly as a dock category does.

When the dock is open, Escape closes it. When the dock is closed and there is a query, Escape clears the query and keeps
the search field focused, leaving the results Open. A second Escape closes those Open results, matching ×. Tab reaches
the menu button, the input, the clear button, and the category chips. The dock remains available via the burger for
layer and download controls.

On phones, activating search instead of the burger follows the compact-search behavior below. The shared header stays in
place in both modes; using search must not implicitly open the full dock.

### Mobile search bar

On phones (viewport ≤ 720 px), the search bar is 44 px tall — smaller than the 54 px base and the 60 px desktop bar. It
spans the screen width minus 12 px gutters on each side. The icon and font are smaller, and touch targets remain at
least 40 px. The categories row is hidden on the main screen to save space; it becomes available inside the open dock
and the search bubble. Focusing the field with the dock closed opens that bubble in Open, with × and a nearest-first
nearby list, without opening the full dock.

### Flip search bar

On flip cover screens (viewport ≤ 400 px wide and ≤ 400 px tall), the search bar shrinks to the menu (hamburger) button
on the main screen — the bar's bounding box is at most the menu button width plus 16 px of padding. The search field and
categories are hidden to conserve space on the small display. When the user opens the dock, the search bar spans the
full width again (as on mobile), and the search field becomes visible and usable. The dock's results with no query make
the bar Open, but Flip shows no × in Open; typing makes it Filled and reveals ×. That × clears the query only, keeping
the dock and its results open. It never closes the dock or the place card: dock closing belongs to the header Icon
Button, whose three-state cycle is described below. The categories row follows the same dock-open behavior as on mobile.

### Full-screen dock on Mobile and Flip

On Mobile (viewport ≤ 720 px) and Flip (viewport ≤ 400×400 px), opening the dock makes it cover the entire layout
viewport — from top 0 to 100dvh, full width, with no map visible around it. The search bar row stays at the top, full
width with its gutters. The dock content ends above the keyboard because it uses the keyboard-aware visible viewport
variables (--visible-top, --visible-height). While the dock is open, the route panel is hidden under it. Opening a place
from the list switches to the search view with the card (`placeCardOpened` in interface.js calls `setView('search')`
when the dock is open on mobile). The menu button closes the dock on Mobile; on Flip the icon button's Close state does
it, as described below. The place card and route panel keep their current behavior when the dock is closed. Desktop
keeps the side dock unchanged (narrower than the viewport, with the map visible beside it).

### Flip three-state icon button

On Flip, the menu icon button (#menu-toggle) cycles through three screens:

1. **☰ Menu** (dock closed): tap opens the full-screen dock showing the search field, categories, and results list.
2. **◇ Modes** (dock open, list screen shown): tap shows the modes menu — Satellite and Transport tiles side by side,
   the "Download for offline use" button, and the one-line license/attribution. The search field stays in the header,
   and the categories row remains visible above the tiles. Everything fits without scrolling at 374×241, 340×250 and
   340×340.
3. **× Close** (modes screen shown): tap closes the dock and returns to the map. The next time the dock is opened, it
   shows the results list again.

Each screen has its own icon (☰ from `#i-menu`, ◇ from `#i-modes`, × from `#i-close` in the SVG sprite), an accessible
name ("Open menu" / "Show map modes" / "Close menu"), and `aria-expanded` on the dock reflecting whether it is open. The
old minimizable footer handle (#footer-toggle) has been removed and replaced by this cycle.

On the modes screen, focusing the search field or typing a query switches back to the list screen, showing filtered
results and updating the button icon to ◇ Modes.

**Compact layout for real Flip screens**: the real Flip cover screen is about 340×250 CSS px (shorter than the 340×340
used in earlier tests). At that height the layout is compacted so at least 3 result rows are fully visible when the dock
shows results: the search bar uses an 8 px top inset (instead of 20 px), category chips are 30 px high with tight
padding, each result row is about 40 px (24 px symbol, 13 px name, 10 px kind/distance with ellipsis). When the modes
menu is shown, layer tiles are compact (icon and label in one row, ~40 px high) and the Download button is ~40 px so
Satellite, Transport, Download and the attribution line all fit without scrolling. These sizes are tested at 374×241,
340×250 and 340×340.

## UI-03 Results scroll; options stay at the bottom

The full dock has three areas: the shared header, a flexible scrolling area for categories/results, and a bottom area
for optional layers and the offline action. Everything is accessible together without nested menus. The burger opens
this full dock on desktop and phone; desktop search also uses it, and so does phone search started with the dock open.

The bottom area's lower edge stays anchored to the dock bottom. Zero, one, or many matches, a loading state, and an
error must not move those options up or down. Results scroll independently when they exceed the available space. An
active download may need more room for progress/cancellation, but its lower edge remains anchored.

Retain all supported categories and directory/search semantics from the baseline. The category strip starts with an
**All** chip, which is pressed whenever no category is selected; every device uses that same state. Pressing the active
category again returns to **All** without clearing the query. Choosing a result opens that place's details along the
bottom, clear of the dock, and the dock and results stay open. Moving or closing the dock does not clear the query,
select route endpoints, or start a route. While a chosen place's details are open, the result list keeps its order.
Choosing From or To closes the dock or search, because the route controls replace them on the map. The category strip
and the place card show no scrollbars; both still scroll.

### Desktop selected-object card

On Desktop (> 720 px) the card is a paper panel along the bottom of the screen: right 0, bottom 0, at most 300 px tall
and clamped to 45% of the viewport height so short windows keep the map controls reachable. It has a top border and no
rounding at the lower corners. It is screen-wide when the dock and search results are closed; with the dock open its
left edge starts at the dock's right edge (400 px), and with the joined Search panel open it starts at that panel's
right edge (380 px). The panel keeps its full height beside it. A visible × is pinned at the card's top right while its
content scrolls; it closes the card, returns focus to the chosen row and leaves the panel open. A click on another map
object swaps the card to that object.

Content uses three explicit columns with about 32 px padding: identity (eyebrow, name, subtitle, a 16 px gap,
side-by-side From/To buttons and the source line), Location and contacts or the building's Addresses and Entrances, then
Opening hours with NEARBY or Inside this building. Any other section uses the last column; weekdays sit left and hours
are right-aligned there. The locate button still rises above the card. The scale bar and OSM credit stay fixed in the
map's bottom-left corner in every search, dock and card state. A screen-wide card, the inset joined search panel or the
Left Dock may cover them because they belong to the map; only the Locate button rises above the card. The card frame
does not scroll; its inner layout does, so the × never scrolls away, and the page itself does not scroll. At card widths
561–780 px the layout changes to identity | all sections; at 560 px and below it becomes one column.

### Selected-object card content

Mobile and Flip keep their existing position, size and state machine; Desktop uses the bottom panel described above. The
header carries the category/type eyebrow, the subject name and an optional short subtitle. The From/To actions stay in
place below the header, followed by one source line with the recorded source, its snapshot date and, when hours are
shown, the note that hours are as recorded rather than checked. Named sections below hold only rows supported by the
data:

- A POI uses **Location and contacts** (address, containing building, coordinates, phone, website and source link),
  **Opening hours**, and **Nearby** when other already loaded directory places lie within 500 m. Nearby lists up to
  three as name · category · distance rounded like a result row. Hours keep weekday labels or the recorded expression.
- A building uses **Addresses**, **Entrances (marked on the map)**, **Inside this building** and **Details**. Entrance
  rows lead with the labels shown on the map, and inside-place hours keep their weekday labels or raw expression.
- Other map objects use **Details** with the attributes appropriate to what was shown.

A section or row is omitted when its fact is absent; the card never substitutes “not recorded” text. Nearby is absent
when no other loaded place is within 500 m, and a recorded containing building address stays with the current selection.
This serves US-04 and US-05 by making the selected subject and its evidence readable in one view, while From/To remain
explicit planning actions. Closing the card clears the inspection highlight and keeps the query, category and endpoints.

The search field shows focus through its caret and a neutral change to the shared bar's border, not the generic focus
ring. Other controls keep the ring.

### Search moves the map only for a chosen result

Opening search, typing, and choosing a category leave the camera still. Choosing a place, building, or address result
moves the map only if that result is outside the focus zone: the inner 75% of the width and height of the map area no
panel covers. A result outside the zone is centered in the uncovered area. Below street level (zoom 15), a chosen result
also zooms in to it, because a pin with no streets around it is not useful. A tap on another map object, such as a
building or stop, still centers that object. The camera also stays still while the phone keyboard is open; the result is
checked again once it closes.

Omit the result count, “nearest first” caption, and Reset action. Tapping the active category again returns to All
without clearing the query; the search field's own clear action removes the query. Use readable result rows with 16px
names and at least 76px height.

### Search result kinds and visible highlights (US-02, US-04)

Current behavior: with the **All** chip active (no category filter) and a typed query, the nearest-first list combines
places with recorded building addresses from the local label snapshot. A street name, alone or with a number, is one
**Address** row (📍); a standalone house, building, section, or entrance identifier is one **Building** row (🏢). One
label yields at most one row, with Address winning when both forms match. Matching is local and lexical, using the
existing Latin/Cyrillic normaliser; it does not imply a ranking service or an authoritative address identity. An empty
query keeps the nearby place list, and choosing any category lists places only.

Every building or address match inside the current view gets a green footprint outline. A place gets a green ring only
while its marker is drawn at the current zoom: a match below its POI threshold stays in the list without a ring until
the marker appears. The leading match may use the existing below-threshold requested marker and is ringed there. The
40-row list limit does not cap the marks. Unchosen results are never painted with the red preview; only a chosen row
removes its green mark and uses the existing red selection instead. Choosing a building or address opens the same point
card as tapping that building on the map, and reveals it by the focus-zone rule above when it is off-screen. Clearing
both query and category removes every green mark. The matching rules, chosen-result behavior, and why the marks are
app-owned are recorded in [ADR 0018](../../decisions/0018-search-result-kinds-and-highlights.md).

### Mobile search keeps the map visible

At the phone layout (the 720px breakpoint), focusing or typing in search with the dock closed opens a results bubble
beneath the unchanged header. With the dock open, search stays in the dock and shows its results there, without the
options while the keyboard is open. With the dock closed, keep it and its layer/download options closed. Categories stay
fixed at the top; only the result list below them scrolls. The category strip may scroll horizontally to reach all
supported categories. Size the bubble to fill the space beneath the header down to the midpoint of the available visible
viewport, even for a short result list. The upper half contains search; the lower half remains map. Use the viewport
remaining above the on-screen keyboard when calculating that limit, not the obscured layout height.

Keep the map visible and interactive without a blocking scrim. Show matching places on the map using the same identities
as the result list. Green marks cover every in-view building or address outline and every place whose marker is drawn;
choosing one replaces its green mark with the red selection. Results outside the view are not drawn, but choosing one
reveals it by the focus-zone rule. Do not relocate the geographic marker. A chosen result must not stay hidden under the
search UI, keyboard, or card. More distant matches may require choosing a result rather than forcing every marker into
one tiny view. An empty search result must not create a fictitious marker or ring.

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

The location button is a toggle. With a usable fix, clicking it starts following: the camera moves to the fix and stays
locked to every new fix. The button fills with the app's pressed-toggle colour (green background, white icon), and
`aria-pressed` reflects the state. The accessible name stays constant — "Follow your location" when a fix is usable,
"Locate me" otherwise — so the label does not change with the toggle. Following stops on:

- A second click on the button;
- Any camera move the follower did not make (user drag, pinch, scroll, or an app-initiated move such as choosing a
  search result, toggling a layer);
- Location failure (denied, timeout, outside the map) or when the permission prompt is dismissed.

Following does not stop on a map resize (viewport change).

Without a usable fix, clicking the button requests or retries positioning, or shows concise actionable recovery. Never
move to a fabricated position or call the fallback camera the user's location.

Minimal wording does not remove required attribution (on-map credit and dock footer), sourced facts in object details,
permission handling, coverage limits, or action-specific failures. Keep those explanations attached to the relevant
feature/action. Do not replace readable labels with unexplained pictograms or rely on color, hover, or a tooltip alone
for essential state. Follow the [UI accessibility guidelines](../../engineering/ui.md) for names, focus, touch targets,
and reduced motion.

## Acceptance

| ID     | Check                                                                                                                                                     | Pass condition                                                                                                                                                                                                                                                                                                                                                    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-A01 | Open with no app interaction.                                                                                                                             | Only the opening controls and geographic scene are present; dock content is closed.                                                                                                                                                                                                                                                                               |
| UI-A02 | Toggle the dock at an unchanged viewport.                                                                                                                 | Header/control bounding boxes, shape, and text baseline remain unchanged; query, category, focus, and selection survive.                                                                                                                                                                                                                                          |
| UI-A03 | Search for zero, one, and many places; scroll results; include loading/failure.                                                                           | Categories remain fixed while the result list scrolls. Full-dock bottom options stay anchored; mobile search is capped and leaves the map visible.                                                                                                                                                                                                                |
| UI-A04 | Inspect bottom options.                                                                                                                                   | Two labeled pictogram tiles and the download action; no Standard map option, redundant headings, nested menus, or generic prose.                                                                                                                                                                                                                                  |
| UI-A05 | Activate location with a fresh fix, then test following, stop conditions, and unavailable positioning.                                                    | A usable fix starts following (green toggle, aria-pressed); new fixes move the camera; a second click, a map drag, a search result, or location failure stops following; unavailable positioning follows the recovery path without inventing a location.                                                                                                          |
| UI-A06 | Toggle layers and start/cancel/fail a download.                                                                                                           | Actual state is clear at its control; optional failures preserve browsing and an existing verified download.                                                                                                                                                                                                                                                      |
| UI-A07 | Use keyboard, screen reader, and touch.                                                                                                                   | Controls have names/states, visible focus and adequate targets; closing restores focus without reopening the dock.                                                                                                                                                                                                                                                |
| UI-A08 | Repeat on desktop, 412×840 phone, around the 720px breakpoint, and short landscape views.                                                                 | Stable header and bottom controls; results remain reachable, with no clipping or overlapping controls.                                                                                                                                                                                                                                                            |
| UI-A09 | On a phone, focus search, type, select different results, and open/dismiss the keyboard; then use the burger and search from the dock.                    | Search started with the dock closed leaves it closed, the bubble is at most half the visible viewport, and a selected marker stays uncovered once the keyboard is dismissed. Burger opens the full dock with query/category retained; search stays in it until a result is chosen.                                                                                |
| UI-A10 | Open search, type, and choose categories; then choose results inside and outside the focus zone.                                                          | Only choosing a result outside the inner 75% of the uncovered map moves the camera, unless it must zoom in to street level. The result list does not reorder while any card is open.                                                                                                                                                                              |
| UI-A11 | On a phone, choose a result, swipe the card up and down, use the strip, and swipe it closed.                                                              | Results and minimized card share the screen; the full card reduces results to the strip; swiping steps back and closes. Closing leaves results open and the camera still; other steps move it only if the place leaves the zone.                                                                                                                                  |
| UI-A12 | On desktop, choose a result and close its card.                                                                                                           | Dock, results, and card are visible together without overlap; closing returns focus to the row and leaves the dock open.                                                                                                                                                                                                                                          |
| UI-A13 | Focus search with no query, type, then use × twice; repeat with the phone dock open. On Flip, open the dock with no query and use × after typing.         | Desktop and phone show Empty → Open → Filled; the first × clears only the query. The next × closes results and any open card, and closes the dock when it is open; on a phone, choosing a result leaves the dock, so its dock × closes the dock without a card. Flip shows no × in Open; its Filled × clears only the query, and the Icon Button closes the dock. |
| UI-A14 | On every device, inspect the first category, press another category, press it again, then open and close the desktop dock.                                | All leads the row and is pressed for no filter; the active category returns to All without clearing the query. The desktop row keeps its scroll position and active chip through dock open/close.                                                                                                                                                                 |
| UI-A15 | Type a query with places and recorded building addresses; pan, choose each result kind, then clear search.                                                | Rows are nearest first with place/building/address symbols and labels; in-view building outlines and drawn place markers are green, the chosen one turns red, an off-screen choice is revealed by the focus-zone rule, and clearing removes every green mark. A category lists places only.                                                                       |
| UI-A16 | On Desktop with no card, the wide card, the search panel and the dock; on phone Peek and Full; and under the Flip dock, inspect the scale bar and credit. | The scale and credit boxes stay at the map's bottom-left within 1 px. At each centre, a covering card, panel or dock is the hit target; otherwise the map control is.                                                                                                                                                                                             |

Automated coverage in [the web browser suite](../../../apps/web/tests/e2e/interface.spec.mjs) checks initial chrome,
unchanged header geometry, anchored options, fixed categories over scrolling results, query preservation, projected
selection visibility, the still camera during search, the focus zone, phone card swipes with simulated touch, desktop
card and dock coexistence, the Empty/Open/Filled transitions and × behavior on desktop and phone, preserving a
map-picked card when desktop focus opens results, a floating chip opening those results, × closing a card and the
desktop dock, the Flip exception (Filled-only × that cannot close the dock), the All chip and active-category return,
seamless desktop row movement, selected-card sections, marker and bare-building picking, gesture cancellation and close
continuity, fixed scale bar and credit geometry and covering-element hits across desktop card/search/dock, phone
Peek/Full and Flip states, and the follow location state machine (start, new fix moves camera, second click stops, drag
stops, search result stops, denied shows recovery, no initial fix, button style).
[The search results suite](../../../apps/web/tests/e2e/search-results.spec.mjs) checks that rows identify places,
buildings and addresses, that unchosen visible matches stay green with no red preview—in-view building outlines and
drawn place markers stay green, and a below-threshold place gains its ring only when its marker is drawn—that choosing
one turns red, reveals an off-screen result when needed, and clears every green mark when the query is cleared. Pure
unit tests cover the state and clear-button functions, search matching, classification and ordering rules, card builders
and footprint membership; no large fake DOM is built for browser behavior. Keyboard geometry is simulated with a smaller
visual viewport; this does not establish physical keyboard, screen-reader, or phone behavior. Review physical-device
usability under [the testing guide](../../verification/testing.md). Keep cartographic-scale/POI stability checks in
[Discover D-05](../user-stories/discover.md#d-05-points-of-interest-without-clutter); the illustrative draft's
cumulative icons do not prove a production placement solution. Paid visibility is outside this UI decision.

## Reusable initial brief

> Create a small, self-contained HTML draft of a laconic, map-first interface for Kompas. Let the person explore the map
> immediately. On opening, show only a combined burger/search bar, an icon-only locate button, scale, a small
> "OpenStreetMap" credit below the scale bar, and full attribution in the left dock footer (per
> [ADR 0016](../../decisions/0016-map-attribution-in-the-left-dock.md)). Keep the dock closed.
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
