# Data, code, fonts, and provenance

Application code: MIT, see LICENSE. Library and data licenses are separate.

- OpenStreetMap-derived geometry and places: © OpenStreetMap contributors, ODbL 1.0. https://www.openstreetmap.org/copyright and https://opendatacommons.org/licenses/odbl/1-0/ . Derived source layers are included in data/sources/; places are in data/sources/places.geojson. The extract originated from Geofabrik Montenegro downloaded 2026-10-18, source timestamp 2026-10-17T20:20:51Z. Data is simplified and incomplete.
- Surrounding-country outlines: Natural Earth public domain, through https://github.com/johan/world.geo.json . These and the inherited Montenegro coastline define the demonstration sea fill.
- MapLibre GL JS 5.12.0: BSD 3-clause and bundled dependency notices, apps/web/public/vendor/LICENSE.txt. https://github.com/maplibre/maplibre-gl-js
- PMTiles JavaScript 4.3.0: BSD 3-clause, apps/web/public/vendor/PMTILES-LICENSE. https://github.com/protomaps/PMTiles
- Open Sans Semibold glyph blocks: copied from https://github.com/maplibre/demotiles/tree/gh-pages/font/Open%20Sans%20Semibold . MapLibre demo distribution notice: apps/web/public/fonts/DEMOTILES-LICENSE. Open Sans project: https://github.com/googlefonts/opensans . The current project's OFL and the historical Apache 2.0 license are included in apps/web/public/fonts/OFL.txt and APACHE-2.0.txt. Fonts are not relicensed by the application's MIT license.
- Build-only geojson-vt: ISC; vt-pbf: MIT; Python PMTiles: BSD 3-clause. Their full npm dependency/license metadata is retained by package-lock.json/npm packages on installation. No paid API or Mapbox service is used.

No company research article text or proprietary map datasets are bundled; research notes summarize public sources and link to them.

## Orthophoto sample

`data/imagery/podgorica/` contains eMapa Ortofoto 2025 sample imagery and provenance. Its reuse licence has not been established. This imagery is not licensed under MIT, ODbL, or Natural Earth's public-domain terms by this project. Original download URLs and hashes are recorded in the sample manifest.

## Bus stops

The dated ePodgorica stop snapshot is attributed to Glavni grad Podgorica / ePodgorica. Source and integrity metadata: data/sources/transport-stops.provenance.json. No explicit reuse license was found; this dataset is not relicensed by the application's MIT license or the basemap's ODbL.
