# Hard-coded town coverage

Issue #328 added [settlements.geojson](../../data/sources/settlements.geojson) from OSM place nodes. This report records
whether the hard-coded town labels and positions in runtime source already have a matching settlement within 2 km. No
application label or position was changed by the Feature.

The audit searched `apps/web/src`, `packages/map-core` and `apps/core-demo` for the twelve city names used by the public
map and for WGS84 coordinate pairs in runtime modules. Distances use the haversine formula on the source coordinates.
Names are compared after Unicode NFD diacritic stripping and case folding; the bilingual OSM name `Ulcinj - Ulqin` is
accepted for the hard-coded `Ulcinj`. Line numbers are a snapshot of this commit.

## Town labels and positions

| Reference                               | Hard-coded value        | Match in `settlements.geojson`    | Distance | Within 2 km |
| --------------------------------------- | ----------------------- | --------------------------------- | -------: | ----------- |
| `apps/web/src/public-map-layers.js:210` | Podgorica               | Podgorica (`node/123860883`)      |  531.9 m | Yes         |
| `apps/web/src/public-map-layers.js:211` | Nikšić                  | Nikšić (`node/255351703`)         |  392.6 m | Yes         |
| `apps/web/src/public-map-layers.js:212` | Cetinje                 | Cetinje (`node/255351379`)        |  218.1 m | Yes         |
| `apps/web/src/public-map-layers.js:213` | Budva                   | Budva (`node/36258939`)           |  327.3 m | Yes         |
| `apps/web/src/public-map-layers.js:214` | Kotor                   | Kotor (`node/29052086`)           |  105.9 m | Yes         |
| `apps/web/src/public-map-layers.js:215` | Bar                     | Bar (`node/49875186`)             |  696.8 m | Yes         |
| `apps/web/src/public-map-layers.js:216` | Ulcinj                  | Ulcinj - Ulqin (`node/192271967`) |  334.3 m | Yes         |
| `apps/web/src/public-map-layers.js:217` | Herceg Novi             | Herceg Novi (`node/123858919`)    |  249.7 m | Yes         |
| `apps/web/src/public-map-layers.js:218` | Žabljak                 | Žabljak (`node/289851953`)        |  117.6 m | Yes         |
| `apps/web/src/public-map-layers.js:219` | Pljevlja                | Pljevlja (`node/292101644`)       |  130.5 m | Yes         |
| `apps/web/src/public-map-layers.js:220` | Kolašin                 | Kolašin (`node/289905750`)        |   24.2 m | Yes         |
| `apps/web/src/public-map-layers.js:221` | Berane                  | Berane (`node/320443766`)         |  242.7 m | Yes         |
| `apps/web/src/core.js:355`              | `[19.26, 42.437]`       | Podgorica (`node/123860883`)      |  531.9 m | Yes         |
| `apps/web/src/app.js:936`               | `[19.26, 42.44]`        | Podgorica (`node/123860883`)      |  242.1 m | Yes         |
| `apps/web/src/status-messages.js:67`    | default view: Podgorica | Podgorica (`node/123860883`)      |  531.9 m | Yes         |
| `packages/map-core/src/map.js:7`        | `[19.259, 42.442]`      | Podgorica (`node/123860883`)      |  260.5 m | Yes         |
| `packages/map-core/src/satellite.js:2`  | satellite bounds centre | Podgorica (`node/123860883`)      |  478.1 m | Yes         |

There is no exact settlement named `Ulcinj` in the OSM extract; the nearest matching bilingual name is within the
radius. Every other label and position has an exact, diacritic-insensitive name match within the radius.

## Other matches, not town positions

| Reference                               | Value                      | Why it is excluded                                               |
| --------------------------------------- | -------------------------- | ---------------------------------------------------------------- |
| `apps/web/src/core.js:356`              | comment: central Podgorica | Describes `DEFAULT_CENTER`, already measured above.              |
| `apps/web/src/point-selection.js:423`   | `source: 'ePodgorica'`     | Transit feed namespace, not a settlement label or position.      |
| `apps/web/src/transport.js:9`           | `coverageBounds`           | Country-wide feed bounds, not a town position.                   |
| `packages/map-core/src/map.js:8-11`     | `mapBounds`                | Country-wide map bounds, not a town position.                    |
| `packages/map-core/src/satellite.js:11` | `podgorica-center.webp`    | Local asset path for the sampled bounds, already measured above. |
| `apps/core-demo/src/app.js`             | none                       | No hard-coded settlement name or coordinate pair in this app.    |

`apps/web/src/status-messages.js:56` names Montenegro as a country, and the interface files contain layout identifiers
such as `gapBelowBar`; neither is a town reference.

## Result

All twelve hard-coded town labels and all five implicit town positions have a settlement within 2 km. The existing
labels remain unchanged; this source only makes the comparison possible from reviewed data.
