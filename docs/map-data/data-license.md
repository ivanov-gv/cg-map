# Data, code, fonts, and provenance

Application code: MIT, see LICENSE. Library and data licenses are separate.

- OpenStreetMap-derived geometry and places: © OpenStreetMap contributors, ODbL 1.0.
  <https://www.openstreetmap.org/copyright> and <https://opendatacommons.org/licenses/odbl/1-0/> . Derived source layers
  are included in data/sources/; places are in data/sources/places.geojson. The extract originated from Geofabrik
  Montenegro downloaded 2026-11-21, source timestamp 2026-11-20T21:21:21Z. Data is simplified and incomplete. Railway
  tracks, platforms, stations and halts in data/sources/railways.geojson come from the same extract and remain ©
  OpenStreetMap contributors, ODbL 1.0; `kind` distinguishes active, disused and abandoned objects.
- Surrounding-country outlines: Natural Earth public domain, through <https://github.com/johan/world.geo.json> . These
  and the inherited Montenegro coastline define the demonstration sea fill.
- MapLibre GL JS 5.12.0: BSD 3-clause and bundled dependency notices, packages/map-core/assets/vendor/LICENSE.txt.
  <https://github.com/maplibre/maplibre-gl-js>
- PMTiles JavaScript 4.3.0: BSD 3-clause, packages/map-core/assets/vendor/PMTILES-LICENSE.
  <https://github.com/protomaps/PMTiles>
- Open Sans Semibold glyph blocks: copied from
  <https://github.com/maplibre/demotiles/tree/gh-pages/font/Open%20Sans%20Semibold> . MapLibre demo distribution notice:
  packages/map-core/assets/fonts/DEMOTILES-LICENSE. Open Sans project: <https://github.com/googlefonts/opensans> . The
  current project's OFL and the historical Apache 2.0 license are included in packages/map-core/assets/fonts/OFL.txt and
  APACHE-2.0.txt. Fonts are not relicensed by the application's MIT license.
- Build-only geojson-vt: ISC; vt-pbf: MIT; Python PMTiles: BSD 3-clause. Their full npm dependency/license metadata is
  retained by package-lock.json/npm packages on installation. No paid API or Mapbox service is used.

No company research article text or proprietary map datasets are bundled; research notes summarize public sources and
link to them.

## Orthophoto sample

`data/imagery/podgorica/` contains eMapa Ortofoto 2025 sample imagery and provenance. Its reuse licence has not been
established. This imagery is not licensed under MIT, ODbL, or Natural Earth's public-domain terms by this project.
Original download URLs and hashes are recorded in the sample manifest.

## Bus stops

The dated ePodgorica stop snapshot is attributed to Glavni grad Podgorica / ePodgorica. Source and integrity metadata:
data/sources/transport-stops.provenance.json. No explicit reuse license was found; this dataset is not relicensed by the
application's MIT license or the basemap's ODbL.

Bus route patterns and stop coordinates in data/sources/transit-network.json are separately attributed to ePodgorica /
Glavni grad Podgorica. Their provenance file records source and sampling. No explicit reuse license was found; they are
not relicensed as MIT or ODbL. Road/foot routing uses FOSSGIS/OSRM with OpenStreetMap attribution retained in the route
panel.

Building address labels in data/sources/building-labels.geojson are derived from the same reviewed OpenStreetMap extract
and remain under ODbL 1.0 with OpenStreetMap attribution. Their provenance retains footprint, input and source identity
information.

## Copernicus DEM GLO-30 relief

The relief vectors in data/sources are adapted products of the Copernicus DEM GLO-30. The raster tiles stay outside Git;
only derived vectors and checksummed provenance are committed. Keep the Article 6(a) source notice with any use of the
relief sources:

> © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and
> ESA; all rights reserved

The derived vectors also carry the Article 6(b) adapted-product notice:

> produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided
> under COPERNICUS by the European Union and ESA; all rights reserved

The source references recorded in data/sources/provenance.json are the
[bucket](https://copernicus-dem-30m.s3.amazonaws.com/), the
[licence PDF](https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_N42_00_E019_00_DEM/INFO/eula_F.pdf) and
the
[CDSE collection description](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM).
They are not relicensed as MIT, ODbL or Natural Earth public-domain data.

The reviewed PMTiles archive contains contour, summit, slope, ridge and canyon-rim layers derived from that DEM, so its
header attribution also carries the Article 6(b) adapted-product notice quoted above. `data/tools/pack.py` reads that
notice and the described coverage from `data/sources/provenance.json`; it does not keep a second attribution string.
Consumers of the archive, including the TileJSON served by the Go host, must keep that notice with the map.
