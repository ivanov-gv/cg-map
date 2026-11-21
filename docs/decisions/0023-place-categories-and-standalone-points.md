# 0023: Place categories and standalone points

## Status

Accepted.

## Context

Issue #327 needs named OSM monuments, viewpoints, gates, fountains, places of worship and similar objects in the place
directory. The published place contract has five categories (`food`, `sights`, `shops`, `stay`, `essentials`), shared by
data validation, the web category filter, the editor rules and their tests. Adding `culture`, `worship` or `public`
would change every consumer for kinds that are sparse in the reviewed PBF. Calling a library or a town hall a sight just
to fit the existing enum would also misrepresent the source and give it sight-level visibility.

## Decision

Keep the five categories. Extract named standalone points from the documented `historic`, `tourism`, `amenity`,
`barrier` and `man_made` values with the OSM value as `kind`; `tourism=information` is included only when named.
Historic and tourism points, named gates and man-made structures, and fountains are `sights`. `place_of_worship`,
`townhall`, `theatre`, `cinema`, `library`, `arts_centre` and `community_centre` are published as `sights` only when a
sight tag (`tourism=attraction`, `heritage=*` or `historic=*`) promotes them; otherwise they are not published until the
category contract is extended in a separate reviewed change.

A point is `standalone: true` only when no published building footprint contains it. The same footprint join sets
`buildingEntityId` on places inside a building, so a standalone point never carries both fields. Facts are copied
verbatim from OSM; `contact:*` fills the plain key only when that key is absent. Visibility levels come from the
reviewed policy and level 1 stays reserved for individually reviewed sights.

## Consequences

The directory gains standalone sights without a breaking category migration; consumers need no new filter values or icon
families. Some named public and cultural buildings remain absent from the directory until a new category is agreed, and
sight promotion depends on how mappers tagged an object rather than on a claim of significance. Coverage and the fields
copied from OSM are reviewed again when the place snapshot is regenerated; see the
[data runbook](../runbooks/data.md#place-visibility-levels).
