# Verification record

Run date: 18 October 2026.

## Executed and passing

- 20 Node tests: archive header/type/content hash, real dense-city MVT geometry decoding, country/coast tiles, native zoom behavior, official MapLibre style-schema validation, offline-asset/glyph coverage, local search/transliteration, category/nearest sorting, safe external links, successful offline activation, corrupt-download rejection, cancellation, reopening a local package, service-worker shell installation, range exclusion, cached-shell reads without network, actual shipped-vendor API compatibility, activation without forced navigation, normalizing cached redirected HTML for navigation, and both range-capable/full-response HTTP transport paths.
- 5 Python tests: range forms and rejection; the actual HTTP handler serving 127 bytes from the actual PMTiles archive with 206 and correct Content-Range/length; unsatisfiable 416; JavaScript HEAD/MIME; URL-encoded font path.
- JavaScript syntax checks for application, offline code, service worker, and supplied browser-check script.
- Python compile checks for the host and build/package helpers.

The vendor API test executes the shipped MapLibre and PMTiles browser bundles in a JavaScript VM and checks entry points used by the application. It reproduced the reported `maplibregl.supported is not a function` failure before the fix. Map creation now handles graphics initialization directly through the normal startup error handler.

The HTTP handler tests use in-memory request/response sockets. No preview server or browser was started.

Authenticated HTTP checks against the deployed site returned 200 for `/`, `/sw.js`, and `/data/manifest.json`. `/index.html` followed a redirect to `/`. The navigation regression test reproduces that redirected-response property and verifies a non-redirected response with preserved HTML/content type. The test failed before the fix. Activation also no longer waits on client navigation. These checks are not a substitute for actual Chrome service-worker/browser testing.

Archive: 12,516,471 bytes; SHA-256 `d4f4f7de5f0ccb10a83f231b98d12844bf883db6e31382c841baf41cc1300990` is recorded authoritatively in `web/data/manifest.json` (use the manifest if this prose differs). Native vector zooms 0–16; client overzoom to 23. The archive contains roughly 229K addressed tiles, with repeated content deduplicated. Offline app+data size is approximately 14 MB; exact bytes are in the manifest.

## Not executed

- No real browser screenshots, gesture tests, or phone GPU/FPS measurements. The environment's website workflow prohibits improvising browser automation when its required browser capability is unavailable.
- The Playwright script `tests/browser-check.mjs` is supplied but unexecuted. It covers desktop/mobile viewports, place-card close, search reset, close zoom, orientation-sized resize, download, offline reload, and screenshots. Run it against the supplied local server in an environment with Playwright/Chromium installed. It is a functional check, not a phone performance benchmark.
- The optional Go host was not compiled because Go is unavailable here.
- HTTPS deployment transport behavior and offline use on the actual Samsung device require verification. Publication success alone is not a visual QA result.

## Next device checks

1. Dense Podgorica: repeated fast pinch in/out, long pan, and zoom beyond the old 20 m display scale. Record transitions, not only final frames.
2. Open and close place details repeatedly. Confirm that the map canvas does not change size.
3. Rotate/fold/unfold, open the keyboard, and background/restore the app. Check canvas size and recovery.
4. Complete an offline download, enable airplane mode, close/reopen, pan to an unvisited region, and reload.
5. Cancel downloads; simulate full storage or interrupted network; confirm previous usable data is preserved. Node tests cover transaction logic but not the browser's actual storage implementation.
6. Run for 10 minutes and inspect memory, slow frames, worker time, and graphics context loss. Compare fixed render resolution budgets before increasing pixel ratio.

Proposed target: near 60 FPS for normal warm gestures on the target phone, with p95 frame time and long stalls reported. No claim that this target has been measured or met.

Additional deployed HTTP evidence: the demo returned HTTP 200 with all 12,516,471 bytes for a 127-byte range request. The transport tests reproduce that behavior and verify reuse of one complete archive response. Range-capable hosting still reads only small byte ranges.
