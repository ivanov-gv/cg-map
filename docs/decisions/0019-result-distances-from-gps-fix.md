# 0019: Result distances come only from a usable fix

## Status

Accepted.

## Context

Issue #262 identified that search rows showed an approximate straight-line distance from the map centre. After a usable
GPS fix recentred the camera, that number could look like a distance from the person even when positioning was stale,
still acquiring, denied, unavailable or outside the covered map. The camera is a fallback view, not a known position.
Issue #248 also requires an open details card to keep its row order, so a late fix must not make a chosen row jump.

The local app has no search service or editorial data source; the only trustworthy origin is the in-memory position
snapshot already used by the location control. Fresh live and approximate fixes carry usable coordinates; other states
must not stand in for the person.

## Decision

- Ranking takes an optional distance origin. A live or approximate fix supplies that origin; every other state supplies
  none. The map centre remains the fallback for ordering only.
- Result rows show distance text only when an origin exists. Without one they keep centre order and render no distance
  span at all. Distance remains a ground approximation, never a route length or travel time.
- The same origin and text rule applies to places, buildings and addresses in every result surface. The details card and
  its existing nearby content are unchanged.
- A changed origin refreshes rows at most once per 200 ms, with a final trailing refresh so a burst of fixes ends with
  the latest position. While a card is open, the refresh is deferred until the card closes.
- This supersedes the distance-provenance part of [ADR 0018](0018-search-result-kinds-and-highlights.md): its historic
  centre ordering remains the fallback, but the camera is never presented as the person's location. Current behavior is
  documented in [the interface guide](../ui-ux/features/interface.md#distance-comes-from-the-person-not-the-camera).

## Consequences

- A person without a usable fix sees useful nearest-first results but no misleading distance claim or false precision.
- Fix-based ordering can differ from the order implied by the current camera; that is intentional, because nearby means
  near the person when their position is known.
- Throttling bounds rebuilds during rapid location updates; the trailing run adds a short delay before the final order
  appears. Deferring a refresh while a card is open preserves the chosen row's place until the person closes the card.
- No new transport, storage or contract is introduced. Coordinates stay in memory, as required by the location policy.
