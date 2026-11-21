# 0022: Extracted land and water kinds

## Status

Accepted.

## Context

Issue #326 needs the display map to distinguish parks, meadows, gardens, woods, sports grounds, cemeteries and grass;
water areas and waterway lines; and a coastline separate from the sea derived from it. A previous extract collapsed most
green areas into `park` and most water areas into `water`, so the source could not answer what an object is or why it
was classified that way. Adding a ninth source file for coastline lines would force a wider editor-bundle and consumer
change than the internal source editor and the two rendered layers need.

OSM objects often carry several candidate classification tags, and raw OSM geometry does not guarantee the winding that
GeoJSON consumers expect for polygon interiors. The data check must reject a new kind or reversed ring before it reaches
a release, without treating preserved country and Natural Earth outlines as generated geometry.

## Decision

Publish one `kind` per OSM object from the first matching rule in a documented priority list, and keep the deciding
`key=value` in `osmTag`. Green areas use the kinds in `source-land-water.schema.json`; a meadow or grass area is marked
`destination: true` when it is named, is a mapped clearing, or contains a named place, POI or peak node. Water areas and
waterway lines use their own kind list. Waterway and coastline features stay one per OSM way in upstream node order,
with waterway names and verbatim `tunnel` and `intermittent` tags.

Coastline lines live in `water.geojson` beside the existing fills and lines. The sea remains one `derived:ocean` polygon
computed from the reviewed land outline and the OSM coastline. Extracted green and water polygons use RFC 7946 winding:
counterclockwise exteriors and clockwise holes. Country and context outlines keep the winding of their preserved source.
`check-data` reads the shared contract's kind enums and property limits, requires `osmTag` on extracted features, and
validates both the kinds and the generated polygon rings.

## Consequences

Consumers must handle more values than `park`, `water` and `river`; the shared fill expression, web land and water
selection labels, and editor rules are updated with the source. An additive `osmTag` exposes the reason for a kind
without carrying every OSM tag. A first-match rule is predictable but never claims that OSM tags are mutually exclusive.
Normalizing ring order can change stored coordinates' sequence without changing geometry, while holes and multipolygon
parts remain intact. The coastline stays a line feature without another source file, at the cost of a mixed geometry
layer that consumers separate by geometry type and kind: water polygons fill, waterways stroke, and coastlines stay out
of the river stroke so the ocean fill shows the shore. See the
[data runbook](../runbooks/data.md#green-areas-and-water-extraction) for the extraction and validation procedure.
