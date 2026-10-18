# Map engineering research and architecture decisions

Research date: 18 October 2026. Project: Kompas, a read-only map and place directory for Montenegro.

This records the research behind the architecture discussion, including alternatives and material limitations. Public documentation and first-party developer accounts are evidence; the proposed architecture and acceptance targets are our engineering judgments. Historical articles do not establish a company's complete current architecture. Benchmark numbers below are specific to their original environments, not predictions for this project.

## Scope and constraints

- Public users browse, pan, zoom, search/filter places, open details, and download for offline viewing.
- Editing is deferred to a future internal workflow. No public drawing, edit synchronization, or contributor accounts.
- Free/open libraries, portable hosting, no Terraform, no mandatory proprietary cloud service.
- Existing data: 25,213 central-Podgorica buildings, 17,881 road features, 1,811 places. Attractions and major roads cover Montenegro; detailed buildings/businesses are local. Counts describe this extract, not the country's complete map.
- Target growth is approximately 10K users, but daily and concurrent users must be distinguished.

## 1. Google Maps: raster and vector are different rendering paths

Source: [Google Maps JavaScript API: rendering type](https://developers.google.com/maps/documentation/javascript/map-rendering-type).

Google documents both raster and vector maps: the former assembles server-rendered images, while the latter renders client-side with WebGL. Availability/defaults vary with API integration. This supports vector rendering as a mature option, not a claim that every Google Maps surface uses the same implementation.

Implication: geometry can be restyled and rendered at the current scale rather than enlarging a bitmap. It still needs bounded geometry, suitable styles, and a graphics-capable device. Google's private backend is neither disclosed by these docs nor something we need to reproduce.

## 2. Yandex Maps: optimize the complete frame path

Source: [Yandex engineering, 2019: WebAssembly experiment and why JavaScript remained](https://habr.com/ru/companies/yandex/articles/475382/).

The article describes vector-tile processing in Web Workers: decode tile data and prepare geometry/rendering buffers. Individual WebAssembly operations accelerated much more than the overall processing path. Reported worker-processing improvement was about 20–25%, with additional initialization and bundle costs. The team retained JavaScript at that time.

Implication: profile decoding, geometry preparation, label placement, upload, and drawing separately. Avoid building a Go/Wasm engine because one microbenchmark looks promising. This historical decision does not establish Yandex's 2026 implementation.

Related current public API reference: [Custom WebGL layers](https://yandex.com/maps-api/docs/js-api/object/layers/custom-layers.html). Its existence is not a disclosure of the entire consumer product.

## 3. 2GIS: marker placement is a real workload

Source: [2GIS engineering, 2019: fast marker generalization on a WebGL map](https://habr.com/ru/companies/2gis/articles/442720/).

The team compared collision approaches on a historical 100K-marker desktop benchmark. Specialized occupancy representations outperformed more general approaches; labels with richer requirements retained a different structure. The lesson is to exploit the actual semantics of each visual feature, rather than treating all markers and labels identically.

Implication: cluster directory points at low zoom, avoid thousands of DOM markers, and measure labels separately. Do not present the article's desktop timings as expected Android frame times.

## 4. 2GIS: canvas rendering needs visual tests

Source: [2GIS engineering, 2023: testing a WebGL map](https://habr.com/ru/companies/2gis/articles/721452/).

Canvas contents are not represented by individual DOM elements. The article discusses screenshot-based verification and determining when rendering has actually completed.

Implication: asserting that a canvas exists is insufficient. Stable screenshots need deterministic data, fonts, viewport, and render readiness. Transitional flashes need frame sequences or recordings; a final-state screenshot misses them. Rendering environments and GPU differences must be accounted for.

## 5. 2GIS: public map-serving architecture

Source: [2GIS on-premises Maps architecture](https://docs.2gis.com/en/on-premise-api-platform/architecture/maps).

The documented platform separates tile delivery, style-related services, and other map capabilities. Different client types consume different tile products. Loading visible geographic pieces bounds client work.

Implication: map byte delivery can scale separately from directory/editorial data. The platform's larger infrastructure choices, including its tile storage stack, are not requirements for a 10K-user Montenegro directory.

## 6. Apple: batch geometry and expose offline lifecycle

Sources: [WWDC 2019 MapKit session](https://developer.apple.com/videos/play/wwdc2019/236/?time=2201); [Apple Support: offline maps](https://support.apple.com/en-gb/105084).

The MapKit presentation recommends grouping overlay geometry to reduce object/rendering overhead and discusses vector-overlay behavior. This is evidence about public MapKit overlays, not a full account of Apple's private map engine.

Apple's offline-map product makes region selection, package size, and update behavior visible. Our takeaway is to give downloads an explicit state and manage their lifecycle. Consumer Apple Maps features do not imply identical offline support in MapKit JS or third-party apps.

## 7. MAPS.ME and Organic Maps: offline is an architecture

Sources:

- [MAPS.ME historical public repository](https://github.com/mapsme/omim).
- [Organic Maps repository](https://github.com/organicmaps/organicmaps).
- [Organic Maps source structure](https://github.com/organicmaps/organicmaps/blob/master/docs/STRUCTURE.md).
- [Organic Maps generator](https://github.com/organicmaps/organicmaps/blob/master/tools/python/maps_generator/README.md).

The public native codebases separate rendering, map generation, indexing, search, and downloaded data management. The Organic Maps generator documentation also makes application/map-format compatibility explicit.

Implication: reliable offline use depends on local data, indexes, and compatible versions. Forking an existing offline product can deliver substantial functionality, but it introduces a large native codebase and specialized build pipeline. It is excessive for this small read-only web PoC unless native navigation becomes central.

Do not assume the historical MAPS.ME repository describes every component of the current commercial product. Code, fonts, bundled datasets, and downloadable map distributions can have different licenses.

## 8. MapLibre: why it is a candidate, and what it does not solve

Sources:

- [Large-data performance guide](https://maplibre.org/maplibre-gl-js/docs/guides/large-data/).
- [Developer discussion: rendering performance](https://github.com/maplibre/maplibre-gl-js/discussions/3590).
- [Maintainer discussion: caching and offline](https://github.com/maplibre/maplibre-gl-js/discussions/6910).
- [API: Map lifecycle and resize](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/).

MapLibre provides integrated vector styling, camera interaction, labels, and GPU rendering. Its guidance still recommends reducing feature/property complexity, using tiles for large inputs, and controlling points and styling costs.

The caching discussion distinguishes memory/HTTP caching from an application-controlled persistent offline store; custom protocols are an integration point. This supports separating renderer choice from storage choice.

Implication: keep one map instance, use prepared vector tiles for the basemap, update place data only when needed, and avoid remounting the map during UI state changes. Worker/GPU/memory bottlenecks remain possible. A smaller bundle or a blank demo scene does not establish performance on our workload.

## 9. OpenLayers and Leaflet alternatives

Sources: [OpenLayers WebGL vector tiles](https://openlayers.org/en/latest/examples/webgl-vector-tiles.html); [OpenLayers project](https://github.com/openlayers/openlayers).

OpenLayers is a credible alternative, particularly for GIS-oriented tools and varied spatial workflows. Its vector-tile WebGL example prevents the inaccurate shortcut of classifying it as a raster-only engine. Choose through representative testing, not generic FPS claims.

Leaflet remains useful for simpler maps, raster imagery, and overlays. Vector rendering plugins can extend it, but their labeling, interaction, lifecycle, and maintenance must be evaluated. The earlier prototype's incorrect asset references and tile positioning were application bugs, not proof of a fundamental Leaflet defect.

Renderer decision: try MapLibre first because the public product emphasizes continuous styled map browsing. Revisit if actual target-device tests fail or GIS editing becomes the dominant product.

## 10. PMTiles: format, range requests, and update costs

Sources:

- [PMTiles concepts](https://docs.protomaps.com/pmtiles/).
- [PMTiles v3 engineering overview, 2022](https://protomaps.com/blog/pmtiles-v3-whats-new).
- [Static hosting configuration](https://docs.protomaps.com/pmtiles/cloud-storage).
- [Go CLI](https://docs.protomaps.com/pmtiles/cli).

PMTiles packages tiles in one archive with indexes that support HTTP byte-range retrieval. It can contain vector or raster tiles: choosing PMTiles does not itself choose vector rendering. Version 3 reduced initial lookup overhead and supports cancelling superseded tile work.

The archive is read-only; normal updates create a replacement. HTTP hosting must actually support ranges, and split-origin deployments need appropriate CORS behavior. Cloud storage is optional: a conventional HTTP server can serve the archive.

Our decision: an immutable, content-addressed MVT archive is convenient for both online range access and a complete offline download. Revisit if measured range latency, caching, or frequent package replacement becomes problematic.

## 11. Real developer disagreement: PMTiles versus ordinary tile delivery

Source: [OpenFreeMap/PMTiles latency discussion, 2024](https://github.com/hyperknot/openfreemap/issues/16).

Maintainers compared latency observations and challenged whether large archive sizes or specific providers explained the results. The debate is useful evidence that delivery must be measured on the actual hosting path. It is not proof that large archives always perform badly or that all storage services behave alike.

Experiment: serve the same data directly through PMTiles range reads and through ordinary XYZ tile URLs; compare cold/warm startup, p95 tile latency, and fast-zoom behavior. Keep the renderer and style fixed to isolate transport.

## 12. Martin, MBTiles, and dynamic PostGIS tiles

Source: [Martin documentation](https://maplibre.org/martin/).

Martin can serve static archives and PostGIS-backed tiles. This gives us an escape hatch from browser-side archive access without changing the geographic data or map renderer.

Alternatives:

| Delivery | Benefit | Cost |
| --- | --- | --- |
| Individual XYZ tile files | Ordinary HTTP objects | Many files and less convenient complete downloads |
| MBTiles plus server | One SQLite artifact; conventional endpoints | Running service required |
| PMTiles direct | Static range serving; one downloadable artifact | Lookup/range behavior; whole-file replacement |
| PMTiles plus tile server | Archive plus conventional tile URLs | Additional process |
| Dynamic PostGIS | Fresh geometry without full rebuild | Database work in the pan path; offline snapshot still needed |

No dynamic tile service is needed for the current read-only PoC.

## 13. Offline browser storage and native alternative

Sources:

- [MDN storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria).
- [MapLibre offline PMTiles reference implementation](https://github.com/makinacorpus/maplibre-offline-pmtiles).
- [MapLibre Native Android PMTiles support](https://maplibre.org/maplibre-native/android/examples/data/PMTiles/).

Browser storage has quota and eviction rules. Persistence can be requested; user clearing and other lifecycle limitations remain. The referenced web plugin demonstrates OPFS and custom-protocol integration, and explicitly requires separate treatment of fonts/sprites. It is a reference, not evidence that every failure case is solved.

Native Android supports local PMTiles, but the documentation explicitly excludes these sources from the SDK's offline-pack downloads/caching. A native app must manage the file download itself.

Decision trigger: if retained offline country data is a hard product guarantee, evaluate native Android early. If a user-installed PWA with browser-managed retention is acceptable, prove it on target devices first.

## 14. Building data and matching styles

Sources: [Planetiler](https://github.com/onthegomap/planetiler); [Protomaps basemap pipeline](https://github.com/protomaps/basemaps).

Established generators can prepare vector basemaps from OSM before users request them. Styles depend on the chosen layer/attribute schema; an arbitrary style will not necessarily work with an arbitrary vector archive.

Production direction: choose a matched schema and style, test coastlines and geometry validity, inspect representative dense areas, publish immutable versions, and retain rollback artifacts.

PoC implementation intentionally reuses the existing extract and a small custom style rather than claiming production cartographic completeness. Its geojson-vt/vt-pbf build is offline preparation, not runtime whole-country geometry processing.

## 15. Internal editing later

Sources: [Terra Draw](https://github.com/JamesLMilner/terra-draw); [MapLibre drawing example](https://maplibre.org/maplibre-gl-js/docs/examples/draw-geometries-with-terra-draw/).

Terra Draw supports map-engine adapters and is a candidate for future internal drawing. Tiled display geometry is clipped/simplified, so it should not be the sole authoritative editable feature record.

Future internal system: store complete features with stable IDs and revisions; validate geometry; publish place snapshots and basemap builds. Immediate overlays can bridge the gap between a reviewed correction and the next full build. Public users remain read-only.

## Architecture decisions for this PoC

1. Browser-first, MapLibre GL JS, single persistent instance. Native remains an option if offline reliability or target GPU behavior fails.
2. Prebuilt MVT in a PMTiles archive. Online range reads; downloaded-file slices for offline access.
3. Independent place snapshot, local search/filtering, clustered GPU point rendering. No public editing.
4. No database or Go API required. Optional standard-library Python and Go HTTP hosts are supplied.
5. Download the app, fonts, and data explicitly; validate the archive before activating it. Do not blindly cache 206 responses as complete files.
6. Keep resizing tied to actual container changes; display the place card as an overlay.
7. Self-contained runtime: no CDN, API key, paid library, or vendor account required after obtaining the package.

## Scaling reasoning

Client frame performance is largely independent of account count. Server latency and throughput affect loading, not the cost of drawing a cached scene.

Illustrative assumptions, not forecasts: 10K daily users × two sessions × 100 fetches × 30 KB is about 60 GB/day and 2M requests/day (~23 requests/second average). Bursts need measurement. Ten thousand 100 MB offline downloads would transfer about 1 TB.

Start with static delivery and snapshots. Add a Go editorial service when shared publication exists. SQLite can suit a small single-host workflow; PostGIS earns its place through concurrent editorial/spatial needs, not a user-count threshold. Scale bandwidth/cache/delivery separately from directory APIs. No Kubernetes or Terraform is required.

## Validation plan and limitations

Targets are proposed, not measured: aim near 60 FPS for ordinary warm gestures on the target phone; inspect slow-frame distributions rather than averages alone. Test cold/warm cache, rapid zoom, continuous pan, dense place scenes, resizing/orientation, keyboard display, background restoration, storage failure, interrupted download, and update rollback.

Use deterministic screenshots for settled scenes and recordings/frame samples for flashes. Emulated mobile viewports do not reproduce a physical phone GPU or thermal/memory limits. Headless software rendering is especially unsuitable for absolute performance claims.

Current environment: browser QA is unavailable under the provided website workflow. Archive decoding, map-style validation, search behavior, offline transaction simulations, asset checks, and range parsing can be exercised. Physical Android behavior and actual visual smoothness remain unverified; see TESTING.md for the exact run record and outstanding checks.

## Open decisions to resolve with evidence

- Direct range delivery versus XYZ delivery on the selected host.
- Browser offline retention versus a native Android client.
- A complete nationwide basemap pipeline and its actual package size.
- Font/language coverage, label density, and GPU pixel-ratio budget on target devices.
- Update cadence and regional packaging before a download audience grows.
- Geospatial/editorial database needs when internal tools are introduced.

The correct next step is a representative device test, not more infrastructure.
