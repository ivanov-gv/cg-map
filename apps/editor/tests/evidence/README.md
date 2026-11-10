# Editor browser evidence

Screenshots for [issue #44](https://github.com/ivanov-gv/cg-map/issues/44), captured from `make -C apps/editor dev` with
Chromium and software rendering. They document the visual review; behavioral regressions live in the browser specs.

- [City view](issue-44-city.png): 1280 × 800, zoom 14, POI mode. Normal public icons and names remain; guides are
  suppressed.
- [Neighbourhood POIs](issue-44-pois.png): 1280 × 800, zoom 17. Hollow guides surround category icons beneath their
  names.
- [Phone POIs](issue-44-phone.png): 412 × 840, zoom 17. The same rendering fits above the bottom toolbar.

The screenshots use the reviewed local map release and retain its compact attribution control. They do not demonstrate
applied edits, offline installation, or a real phone's keyboard; those behaviors are checked separately.
