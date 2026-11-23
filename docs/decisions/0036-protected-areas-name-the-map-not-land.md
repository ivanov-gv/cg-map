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
- The archive publishes the polygons as a `protected_areas` layer with `kind`, `name` and `name:en`. map-core draws it
  as an invisible fill, so it covers nothing but can be hit-tested. The web app picks a named green area or named water
  first, then the protected area, then unnamed green areas and water: a tap on Gorica's woods opens Park šuma Gorica.

## Consequences

- Park šuma Gorica and three other protected areas get their names on the map; large ones, such as Lake Skadar National
  Park, label their whole extent from one long-axis line.
- A long label line that crosses tile edges can repeat its name at high zooms.
- The layer adds about 0.7 MB to the archive, mostly Lake Skadar National Park's outline at the detail zooms.
- A refresh with `--layers protected-areas` needs the reviewed PBF, like every partial extract.
