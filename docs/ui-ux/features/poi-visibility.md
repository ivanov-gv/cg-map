# Stable POI visibility

Status: implemented; awaiting density sign-off on real devices. See [open points](#open-points).

Serves **US-02** (find a known place), **US-03** (discover something useful nearby), and **US-04** (inspect a listing).
Read [Discover D-05](../user-stories/discover.md#d-05-points-of-interest-without-clutter) for geographic relevance and
[the interface](interface.md) for control layout. This feature refines D-05's stability requirement.

## Intended result

Every directory POI has an assigned visibility level. Its icon appears at that level's zoom threshold and remains
eligible at every closer zoom. Small scrolls and pans must not replace one eligible icon with another merely because the
label engine found a different arrangement.

This applies to directory businesses, facilities, and sights. Position, route endpoints, live buses, optional transport
stops, road shields, and house numbers retain their separate behavior. Text beside a POI may be omitted when space is
limited; an absent name must not remove its icon.

## PV-01 Fixed, cumulative levels

These thresholds and assignments are product configuration, not measured significance. Most shops moved from level 4 to
level 5 after the first real-data review, when their icons piled up at zoom 16. Level 1 is empty until a landmark is
individually reviewed.

| Level | Minimum MapLibre zoom | Initial assignment policy                                                                               |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| 1     | 12                    | Explicitly reviewed landmarks with a recorded reason for broad visibility. No category-wide assignment. |
| 2     | 14                    | Museums and hospitals; individually reviewed places needing earlier local visibility.                   |
| 3     | 15                    | Pharmacies and accommodation.                                                                           |
| 4     | 16                    | Ordinary food/drink, supermarkets, malls, department stores, galleries, and other unreviewed sights.    |
| 5     | 17                    | Other shops, ATMs, banks, fuel, post offices, small memorials/artworks, and unknown kinds.              |

More specific kind rules override category defaults: a memorial remains level 5 although its category is sights. Publish
an exhaustive kind/category mapping and explicit ID overrides; do not infer fame from a name, listing order, distance
from the camera, or the number of businesses nearby. No level-1 landmarks are invented to populate that band. Level 1 is
the earliest/highest-priority level; a larger numeric level means later appearance.

At zoom `z`, an unfiltered POI's icon is eligible exactly when `z >= threshold(visibilityLevel)`. Equality is inclusive.
There is no upper threshold, random rotation, per-viewport quota, desktop/mobile difference, or hysteresis depending on
the direction of travel. At a fixed release and query/category, the eligible set is cumulative as zoom increases.
Features leaving the viewport or excluded by an explicit filter are legitimate removals.

## PV-02 Icons and names have different rules

The marker's admission must be independent of collision placement for names, addresses, and other icons. Sorting
collision-placed symbols alone does not meet this requirement. Keep names collision-aware and retain essential road,
address, position, and route context. Use stable place identity to order any overdraw; never viewport-y or array order.

Fixed eligibility does not guarantee an uncluttered scene. Control density through reviewed level assignments before
release, without hiding admitted icons dynamically. Review the real dense directory at each band on a phone and desktop.
If a scene remains unreadable, adjust documented assignments/thresholds consistently for the release, rather than
reintroducing viewport-dependent suppression. Do not declare the feature complete from filters or icon counts alone.

Two places at identical coordinates cannot have individually readable icons at the same pixel. Represent eligible
co-located members with one stable shared-location marker; show the eligible count only when more than one member is
present. Tapping it opens a short, keyboard-accessible chooser of the actual listings. On a phone the chooser opens as a
full card; picking a listing shows that listing's normal card, which is a header-only peek when search is open. A count
changes only when a member crosses its threshold or a deliberate filter changes. Preserve every listing's identity and
true coordinates.

For nearby distinct markers that overlap, provide the same multiple-hit chooser rather than silently choosing the first
rendered feature. Do not move geographic anchors, turn ordinary businesses into broad-scale count clusters, or promise
separate readable pixels for co-located listings. Severe remaining overdraw is a release blocker, not permission to hide
icons arbitrarily.

## PV-03 Search, selection, and filters

Search and category choices narrow the directory and map candidates; matching icons still obey their normal thresholds.
Exactly one requested result, the selected listing or otherwise the leading match, may appear below its threshold. It
keeps its highlight at every zoom. The map keeps a selected listing uncovered; a leading match does not move the camera,
so it can be covered or off-screen. Choosing another result moves this one exception. A broad query or category must not
reveal every matching business at country scale. Prevent duplicate base/search icons for the same listing. A selected
listing below its threshold that shares a location with an admitted listing is represented by that location's marker and
highlight, not a second icon. This deliberately replaces the current blanket threshold bypass for explicit filters.

Clearing the explicit filter removes the preview exception. Selection remains visible until closed, even if the user
zooms out below that place's default threshold. Zoom, pan, layer toggles, resizing, and offline reload must not change a
place's assignment. Directory results remain complete and ordered by distance from the map center; map levels do not
limit search or change nearest ordering.

## PV-04 Priority overrides and commercial scope

Support reviewed overrides keyed by stable place ID, so assigning an earlier level does not require changing renderer
code. Record the assigned level and reason separately from OSM facts and geographic significance. An override of one
place must not automatically demote another, change result ordering, or grant a larger icon or guaranteed name label.

This provides the technical basis for a future commercial placement: broader visibility means an earlier zoom threshold,
not periodic or random appearances. Ordinary businesses may be promoted only as far as level 2; broad landmark
significance remains an editorial decision. Do not fabricate paying customers or activate commercial overrides in the
initial release. Actual paid placements will need explicit commercial provenance and a concise Sponsored disclosure when
activated; pricing, contracts, billing, accounts, expiry, analytics, and an editorial service are separate work.

## Current scope and acceptance

The application has per-place levels and an override mechanism. It has no commercial placement system.

Acceptance requires exact ID-set checks below/at/above every threshold, monotonic zoom-in and reversible zoom-out,
small-pan invariance for features kept inside the viewport, input-order invariance, same-level behavior across screen
sizes, independent icon/name collisions, truthful shared-location selection, and search/selection/offline regressions.
Density and essential map readability also need screenshots of real data, not only synthetic fixtures. Browser tests
take them on request with `POI_DENSITY_SCREENSHOTS=1`.

## Open points

- Not yet run: review on real devices, visual review with `make -C apps/web dev`, and `data/tools/extract-osm.py` with a
  real PBF.
- The default camera (zoom 15.8) is just below level 4 (zoom 16), so the first view shows no cafes or restaurants.
- Level 1 is empty and no overrides ship; both need editorial review.
- The shipped snapshot has no co-located listings, so real data has not exercised shared-location markers.
- Clinics and other unlisted essentials take their category's default, level 5.
- Long shop rows still overlap at zoom 17, for example at Bulevar knjaza Danila Petrovića 13. The chooser reaches each
  listing.
- House numbers draw over icons at the same position and partly cover the glyph. Icons stay below road and address
  labels on purpose.
