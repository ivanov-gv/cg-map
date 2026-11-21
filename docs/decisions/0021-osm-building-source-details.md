# 0021: Separate OSM building source details

## Status

Accepted.

## Context

The reviewed building source kept footprint geometry but discarded most OSM tags. The runtime house-number labels carry
a separate `entrances` array for arrows and address display, but that is a display format with derived bearings, not the
OSM entrance source. Issue #324 needed copied building attributes, address joins, recorded entrances and
place-to-building joins without turning the read-only map into an editorial service or changing the published archive.

## Decision

`buildings.geojson` keeps the copied OSM tags, replaces no-number placeholders with `nohousenumber: "yes"`, and adds an
`addr:streetEntityId` only when the case- and whitespace-folded street name matches exactly one published road group.
`building-entrances.geojson` is a ninth, read-only source file for adopted OSM `entrance=*` nodes and their copied tags;
it joins to footprints by `buildingEntityId`. Places inside a footprint gain the same kind of source-identity join. The
existing `entrances` array in `building-labels.geojson` remains the runtime arrow/label format and is not generated from
the new file in this change. No energy-class field is published because the reviewed OSM source does not provide one.

The extractor reads the `buildings.geojson` placeholder rule in the editor contract; a contract test keeps it identical
to the building-label rule, so producer and editor reject the same values. Contracts, source validation, and editor
bundle rules cover all nine source files together.

## Consequences

A data-owned extraction can refresh all four kinds of detail reproducibly, and editors can inspect them without editing
upstream facts. The two entrance representations must be validated against their own contracts: one is an OSM source,
the other a display artifact. The bundle and its checksum contract grow from eight files to nine, so data and editor
tests must move together. Runtime rendering, archive contents and APIs stay unchanged.
