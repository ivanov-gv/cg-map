# 0036: Protected areas name the map, not the land

## Status

Accepted.

## Context

The wiki gives every park a name along its hill (UI 3.Core). Gorica hill showed none: OSM maps it as unnamed `woods`
under a named nature reserve, way 28132307 "Park šuma Gorica" (`leisure=nature_reserve`, `boundary=protected_area`). The
land extract keeps only land-cover tags, on purpose: a protected-area boundary is not cover, and both apps' pinned
map-core fills every non-green land kind with the land colour, so a reserve in `land.geojson` would paint over its
woods.

## Decision

- Named protected areas (`leisure=nature_reserve`, `boundary=protected_area`, `boundary=national_park`) that reach the
  detail box go to a separate read-only source, `protected-areas.geojson`, from the `protected-areas` extract group. It
  keeps OSM identity, names and the selecting tag; `make -C data check` validates it.
- The tile builder adds one `green_area_labels` line per named protected area whose name no green area already shows.
  The archive gets no new layer, so no style or app changes.

## Consequences

- Park šuma Gorica and three other protected areas get their names on the map; large ones, such as Lake Skadar National
  Park, label their whole extent from one long-axis line.
- A long label line that crosses tile edges can repeat its name at high zooms.
- A refresh with `--layers protected-areas` needs the reviewed PBF, like every partial extract.
