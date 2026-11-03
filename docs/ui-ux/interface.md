# Interface: laconic, stable, map first

Status: approved target from the UI draft review on 3 November 2026; **not implemented in the production app**. The
illustrative HTML draft established the composition and interactions, not real geography, positioning, layer switching,
or offline behavior. Browser rendering and physical-device usability have not been verified for that draft.

This document owns control layout, wording, and expansion behavior. [Discover](discover.md) owns the geographic scene
and honest location semantics; [Understand](understand.md) owns selected-object details; [Plan](plan.md) owns journey
preparation and route readiness; [Travel](travel.md) owns live route-following and finishing. Preserve the capabilities
in [user stories](user-stories.md) while changing their presentation.

## Intention

**Let me read the map immediately, then reveal useful controls where I already expect them to be.**

A laconic UI earns its space through an action, information needed for that action, or essential geographic context.
Visual quiet comes from removing redundant controls and wording, grouping related actions, and keeping their positions
stable. A short interface still needs understandable symbols, accessible names, truthful state, and recoverable errors.

- Make the map the principal content. Keep results and optional controls closed on opening.
- Prefer a recognizable pictogram with a short label to a heading, explanatory sentence, and separate control.
- Reveal optional controls through one flat dock. Mobile search uses a compact results bubble so the map stays usable;
  desktop search remains inside the dock. Avoid menus within menus.
- Keep controls still. Opening, filtering, loading, and empty results must not rearrange unrelated actions.
- Remove slogans, obvious instructions, duplicate headings, and routine status prose. Show explanation when it helps
  someone resolve a specific failure or understand a selected object.

## UI-01 Opening view

Show the map, one combined burger/search bar, an icon-only location button, zoom controls, a metric scale, and required
attribution. Default geographic content remains governed by Discover; simplifying controls does not remove roads,
buildings, addresses, terrain, or scale-appropriate places.

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

On phones, activating search instead of the burger follows the compact-search behavior below. The shared header stays in
place in both modes; using search must not implicitly open the full dock.

## UI-03 Results scroll; options stay at the bottom

The full dock has three areas: the shared header, a flexible scrolling area for categories/results, and a bottom area
for optional layers and the offline action. Everything is accessible together without nested menus. The burger opens
this full dock on desktop and phone; desktop search also uses it.

The bottom area's lower edge stays anchored to the dock bottom. Zero, one, or many matches, a loading state, and an
error must not move those options up or down. Results scroll independently when they exceed the available space. An
active download may need more room for progress/cancellation, but its lower edge remains anchored.

Retain all supported categories and directory/search semantics from the baseline. Choosing a result opens that place's
details; moving or closing the dock does not clear the query, select route endpoints, or start a route.

### Mobile search keeps the map visible

At the phone layout (the 720px breakpoint), focusing or typing in search opens a results bubble beneath the unchanged
header. Keep the full dock and its layer/download options closed. The bubble scrolls internally and takes no more than
half the available visible viewport; the header and bubble together should stay in the upper half where space permits.
Use the viewport remaining above the on-screen keyboard when calculating that limit, not the obscured layout height.

Keep the map visible and interactive without a blocking scrim. Show matching places on the map using the same identities
as the result list. Keep the selected result, or the first match before selection, visibly highlighted in the uncovered
map area. Adjust the camera for the bubble and keyboard; do not relocate the geographic marker or leave it hidden under
the search UI. More distant matches may require choosing a result rather than forcing every marker into one tiny view.
An empty search result must not create a fictitious marker.

The burger explicitly opens the existing full dock, retaining the query and category. Returning to search switches back
to the compact bubble. Result selection and keyboard dismissal must keep the relevant place visible. This is a mobile
search exception to the dock composition, not a replacement of the burger menu with a bottom sheet.

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
[Discover D-06](discover.md#d-06-current-position-and-honest-uncertainty).

With a usable fix, activating location recenters immediately; it does not first open a “Your location” explanation or
details panel. Without a usable fix, request/retry positioning where possible, or give concise actionable recovery after
the request fails. Never move to a fabricated position or call the fallback camera the user's location.

Minimal wording does not remove required attribution, sourced facts in object details, permission handling, coverage
limits, or action-specific failures. Keep those explanations attached to the relevant feature/action. Do not replace
readable labels with unexplained pictograms or rely on color, hover, or a tooltip alone for essential state. Follow the
[UI accessibility guidelines](../engineering/ui.md) for names, focus, touch targets, and reduced motion.

## Acceptance

| ID     | Check                                                                                                         | Pass condition                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-A01 | Open with no app interaction.                                                                                 | Only the opening controls and geographic scene are present; dock content is closed.                                                                                                            |
| UI-A02 | Toggle the dock at an unchanged viewport.                                                                     | Header/control bounding boxes, shape, and text baseline remain unchanged; query, category, focus, and selection survive.                                                                       |
| UI-A03 | Search for zero, one, and many places; include loading/failure.                                               | Desktop/full-dock results scroll independently with fixed bottom options; mobile search uses the capped bubble and leaves the map visible.                                                     |
| UI-A04 | Inspect bottom options.                                                                                       | Two labeled pictogram tiles and the download action; no Standard map option, redundant headings, nested menus, or generic prose.                                                               |
| UI-A05 | Activate location with a fresh fix, then test unavailable positioning.                                        | A usable fix recenters directly; unavailable positioning follows the recovery path without inventing a location.                                                                               |
| UI-A06 | Toggle layers and start/cancel/fail a download.                                                               | Actual state is clear at its control; optional failures preserve browsing and an existing verified download.                                                                                   |
| UI-A07 | Use keyboard, screen reader, and touch.                                                                       | Controls have names/states, visible focus and adequate targets; closing restores focus without reopening the dock.                                                                             |
| UI-A08 | Repeat on desktop, 412×840 phone, around the 720px breakpoint, and short landscape views.                     | Stable header and bottom controls; results remain reachable, with no clipping or overlapping controls.                                                                                         |
| UI-A09 | On a phone, focus search, type, select different results, and open/dismiss the keyboard; then use the burger. | Search leaves the full dock closed, the bubble is at most half the visible viewport, and the selected/leading marker stays uncovered. Burger opens the full dock with query/category retained. |

These are target acceptance cases, not claims about existing tests. When implementing, compare measured geometry across
states and result counts, then review appearance and physical-device usability under [the testing guide](../testing.md).
Keep scale/POI stability checks in [Discover D-05](discover.md#d-05-points-of-interest-without-clutter); the
illustrative draft's cumulative icons do not prove a production placement solution. Paid visibility is outside this UI
decision.

## Reusable initial brief

> Create a small, self-contained HTML draft of a laconic, map-first interface for Kompas. Let the person explore the map
> immediately. On opening, show only a combined burger/search bar, an icon-only locate button, zoom, scale, and required
> attribution. Keep the dock closed.
>
> Opening the burger expands a left dock around the existing header. Desktop search uses that dock too. Keep the burger
> and search at exactly the same coordinates, dimensions, and shape across states; preserve typing and focus. Dock
> results scroll; options stay anchored at the bottom regardless of result count.
>
> On phones, search opens a compact results bubble instead of the full dock. Cap it at half the visible viewport,
> accounting for the keyboard. Keep the map interactive and the selected or leading matching marker visible outside the
> bubble. The burger still opens the full dock with the current query and category.
>
> At the bottom, show two pictogram tiles with small labels underneath: Satellite and Transport. Below them, put a
> button labeled “Download for offline use.” No Standard map option, section headings, nested menus, desktop result
> bubbles, slogans, explanatory filler, persistent legend/location banner, or dedicated country/default-city shortcuts.
>
> The location button recenters directly on a usable position. Keep meaningful states, recovery, accessible names,
> keyboard focus, and touch targets. Use an illustrative map for this draft; do not add backend services or claim real
> positioning, layers, or downloads. Make the same composition work on desktop and phone.
