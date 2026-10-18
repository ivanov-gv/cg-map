# Source provenance

`sources/provenance.json` inventories the actual editable layers shipped in this export. `sources/provenance-legacy.json` preserves the predecessor's metadata; its raster-runtime fields are historical and do not describe the current application.

The OSM extract timestamp is 2026-10-17T20:20:51Z. Current display layers have limited coverage and simplified/rounded geometry. There are 25,213 buildings in central Podgorica, 17,881 road features, 284 land features, and 1,491 water features including one derived ocean polygon. The place snapshot has 1,811 entries.

`sources/context-countries.geojson` preserves the supplied Natural Earth public-domain surrounding-country features independently of extraction. The OSM and Natural Earth licenses remain separate.

The original input PBF is not included in Git: it is an external downloadable dataset, not application source. Basemap rebuilding from the included GeoJSON needs no PBF. The original 34,575,491-byte input had SHA-256 `574423f1685e7b0a82a14166ba492376fc824294680ea0c576426ff408230397`. Geofabrik's dated download was `https://download.geofabrik.de/europe/montenegro-261017.osm.pbf`; dated extracts may not remain available indefinitely. The current extract is at `https://download.geofabrik.de/europe/montenegro-latest.osm.pbf` and will have different content/checksum. Retain input snapshots outside the source repository when reproducible refreshes matter.

The added `data/tools/extract-osm.py` is an adaptation of the original small extractor. Its CLI and Python syntax have been checked. A fresh complete PBF extraction was not rerun during this documentation/export task. It is not a full OSM semantic/cartographic pipeline; see ARCHITECTURE.md before using it to expand coverage.

## Bus stops

`data/sources/transport-stops.geojson` contains 719 ePodgorica stops retrieved 2026-10-18 from the public stops/all endpoint. Source IDs and coordinates are retained; only the published stopId, stopName (as name), longitude and latitude are kept. Its independent provenance JSON records the endpoint, retrieval time, hash and count. It is a static snapshot, separate from the OSM layers and live vehicles. No explicit reuse license was found; attribution is retained without assigning MIT or ODbL to this source.

## Transit route patterns

transit-network.json and transit-network.provenance.json are a separately dated public ePodgorica import. They contain stop coordinates and representative ordered route patterns with relative running times, sampled by direction/headsign/stop count from weekday, Saturday, and Sunday trips. They are not an exhaustive timetable or service calendar. Refresh with data/tools/import-transit.py; raw API responses are temporary and excluded from Git. Source URLs, sampling limits, counts, hash, and license status are recorded.
