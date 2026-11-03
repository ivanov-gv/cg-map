# Task: implement the laconic map interface

Status: complete

## Goal and acceptance criteria

- Implement [the approved interface](../ui-ux/interface.md) in the real web app: unchanged burger/search geometry,
  closed initial dock, bottom-anchored optional-layer tiles/download, icon-only location, and no redundant chrome.
- Mobile search fills the space below the header down to the visible viewport's midpoint. Categories stay fixed above
  independently scrolling results, with readable 76px rows and 16px names. Omit the count/nearest-first/Reset row;
  tapping the active category again removes that filter without clearing the query. The leading/selected result remains
  visible on the map. Burger opens the full dock; desktop search uses it.
- Preserve place/object details, routes, source attribution, live transport, verified offline downloads, keyboard
  access, and both hosting paths. No data/contract/backend changes or geography regeneration.

## Decisions

- Keep one map filling the viewport; controls overlay it without changing its container dimensions.
- Separate interface state/viewport geometry from application data and routing. Reuse one search field and one result
  panel; moving the result panel must not move the search header or lose the current query/category.
- Explicit search may emphasize one existing place feature to ensure its icon survives collision placement. General POI
  importance tiers and commercial placement remain separate work.
- Keep route controls available after endpoint selection without requiring a full dock that obscures map selection.

## Progress

- Completed: runtime implementation, documentation updates, focused tests, component and repository verification, final
  desktop/phone browser acceptance, visual inspection of opening/dock/search screenshots, and independent source
  compliance review with no remaining findings.
- Remaining implementation work: none. Physical keyboard, GPS, and screen-reader usability remain device checks;
  simulated viewport coverage does not establish those outcomes.
- Blockers: none. Computer use has no interactive browser surface; development-server screenshots supplied the visual
  review evidence.

## Verification

- `make verify PKG=apps/web`: passed in the isolated implementation worktree and main checkout, including after the
  final test adjustment.
- Focused browser selection was confirmed with `--list`; affected desktop/phone cases passed after fixes.
- `make check`: passed in the worktree and again in the main checkout (92 Node tests, five Python tests, lint,
  contracts, repository boundaries, data validation, web build, and offline manifests).
- `make test-e2e`: passed in the worktree with 53 passing tests and one expected desktop touch skip. The main-checkout
  rerun exposed an error notice covering the offline-removal action on phones. Notices now sit below the header and have
  a dismissal action; all 12 focused desktop/mobile regressions passed, including that recovery, category untoggling,
  search sizing, focus restoration, and route layout at 720/721/768px. An interim routing run exposed an expected
  offline-setup notice from its deliberately blocked service worker. Those isolated tests now assert and dismiss the
  notice before routing; all four focused routing checks passed with their route assertions preserved. The final full
  main-checkout suite passed **53 tests with one expected desktop touch skip** in six minutes.
- Screenshot review covered the desktop and 412×840 mobile opening, full dock, and search results. Browser coverage
  simulates a reduced visual viewport for keyboard geometry.
- `make dev DEV_FLAGS=-live-transport=false`: running successfully from the main checkout. Visually inspected real
  directory results for “Voli” at 1280×800 and 412×840, including opening, dock, and midpoint search layout. Screenshots
  are in `/tmp/cg-map-ui-review`. The isolated worktree's Go VCS-stamping failure does not affect this main-checkout
  run.

## Handoff

Implementation was developed in `/tmp/cg-map-laconic` on branch `laconic-interface` and integrated into the main
checkout without committing or deploying. Unrelated Plan/Travel documentation drafts are preserved. No geographic data,
producer/consumer contracts, or backend behavior changed. General POI importance tiers and paid visibility are separate
work, not implemented by this interface change.
