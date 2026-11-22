# 0023: Join addresses to connected street groups

## Status

Accepted.

## Context

The building extract first joined an address to a road only when the folded street name matched one OSM way. Most
Podgorica streets are split into several ways, so that rule left 788 of 896 addressed buildings unjoined. Published
`roads.geojson` carries clipped, simplified and rounded geometry without OSM node IDs, so a downstream validator cannot
recompute which ways touch.

## Decision

The extractor groups named road ways by folded name and shared end-node IDs. A building joins only when its folded name
has exactly one connected group; several disconnected groups stay unjoined. `addr:streetEntityId` is the group's lowest
way ID and `addr:streetEntityIds` lists every way in the group, in ascending ID order. The validator checks that a join
lists every published road with the same name and uses the lowest ID as its representative; it cannot verify the OSM
connectivity itself, so the reviewed extract is the authority for group membership.

## Consequences

Split streets produce one join with an explicit member list instead of many false ambiguities. A new provenance count
tracks the member-list field, and both producer and validator must agree on the representative. Editor changes to road
names or address text can make a stored join stale, so the importer's validation still rejects it.
