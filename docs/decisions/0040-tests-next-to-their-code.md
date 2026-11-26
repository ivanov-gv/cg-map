# 0040: Tests lie next to the code they test

## Status

Accepted. Decided by the owner on 2026-11-25 ([#458](https://github.com/ivanov-gv/cg-map/issues/458)).

## Context

The tests of the apps lie in `tests/`, apart from 86 source files in one flat folder in the Editor and 27 in Web.
Platform therefore lists files of the apps to tell which tests belong to which change, and almost every PR touches
Platform.

## Decision

- In the apps and packages/map-core a test lies next to the code it tests and its name says what it needs:
  [the layout](../engineering/javascript.md#tests). apps/web and apps/editor sort their sources into folders by feature.
- Each project moves in its own Feature: the Editor ([#455](https://github.com/ivanov-gv/cg-map/issues/455)), Web
  ([#456](https://github.com/ivanov-gv/cg-map/issues/456)) and Core with core-demo
  ([#457](https://github.com/ivanov-gv/cg-map/issues/457)).
- Contracts, data, platform and services keep `tests/`.

How CI chooses tests is the rest of #458 and not decided here.

## Consequences

- A component and its tests move, change and go away together.
- Two layouts exist until the three Features are done.
- A build or package of a moved project has to leave tests out.
