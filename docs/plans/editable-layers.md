# Task: Make data layers editable

Issue: #404 (Epic), with Features #405 to #413. The issues hold scope and status; this plan holds their history.

## Context

The wiki page UI 4.Editor and its Penpot page describe fourteen flows over ten layers. Affected: packages/contracts,
data, apps/editor and tests.

## Decisions

- **One stack, data first.** #405 changes contracts, importer and bundle; the editor Features stack on it.
- **Editor tests keep their pins.** map-contracts and map-data can be released only from main, after the stack merges,
  so new layers are tested on the editor's own small fixture city, and `tests/` checks the real files at HEAD. A Task
  after the merge releases both packages and moves the pins.

## History

- 2026-11-25: derived shapes (municipalities, slopes, the sea) moved from the importer to the editor, so the reviewer
  sees them as operations. Located entrances of a label became editable positions, found while building #407.
- 2026-11-25: plan written with the nine Features.
