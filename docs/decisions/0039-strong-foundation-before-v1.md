# 0039: Strong foundation before v1

## Status

Accepted. Decided by the owner on 2026-11-25. Replaces the rule of [ADR 0024](0024-editor-bundle-versions.md) that older
bundle versions stay readable.

## Context

The owner: "Until we don't have users, until we are not on v1.* we can safely break backward compatibility and make
these kind of logic changes in code. If you're afraid of it - don't. We have to reach the right logical structure inside
this project to avoid problems in the future." Instructions still asked for compatibility, so wrong structures were
kept, with checks and tolerances around them. Each such patch makes the next change slower.

The example is countries and their borders ([#429](https://github.com/ivanov-gv/cg-map/issues/429)). One border is
stored in five places, and the areas of neighbour countries do not match it. The first solution cut the areas to the
border and failed the build when they differ. The owner refused it, because editors would go back and forth guessing the
right shape: "The only right one is to have one entity for a town/city/municipality/country/etc. with connections to its
borders. Only this logic will allow the builder to produce the right country shape from the first try". With it, the
line exists once and the shape is computed.

A second example is the display number, a number that the map would show instead of the house number and that would have
hidden a wrong address. The owner refused it as a sticker: the map part is not built
([#433](https://github.com/ivanov-gv/cg-map/issues/433)), and [#451](https://github.com/ivanov-gv/cg-map/issues/451)
removes the field.

## Decision

While the project is v0.\*, until its first v1 release, a wrong structure is replaced by the right one, even when that
breaks a data format, a contract, saved drafts or an API.

- A fact is stored once. Objects are connected by ID, and everything else is derived.
- A state that must not exist is made impossible by the structure. A check that copies agree, a tolerance and a match by
  distance are signs that the structure is wrong. Checks remain for what structure cannot prevent, such as a line that
  somebody drags across another.
- A problem is fixed where it is. No view-only field, override, rule by name or check is added to hide it, also when an
  issue, a page or a review asks for it. When the fix is too big for now, the problem stays visible and is reported.
- The old format is removed, without an adapter beside the new one. One exception: a consumer (an app or map-core) may
  read the old format until the pin concerned moves, of
  [map data](../system-architecture/architecture.md#map-data-modes) or of
  [contracts](../system-architecture/architecture.md#contract-modes); the PR that moves the pin removes the old path.
- Formats that are still read for compatibility today stay until a change touches them; nothing is removed unasked.
- Data, its provenance and licences are carried over. Published versions never change. The invariants in AGENTS.md hold,
  offline downloads included. Tests are rewritten for the new structure and prove at least as much.
- A change that breaks something says in its PR what a consumer, an editor or an offline user loses, such as saved
  drafts.

## Consequences

- A change can be large: producer, contract and consumers change for one structure. The dev site and dev builds read
  HEAD, so they must work after each merge; pins keep the tests of the apps on their release meanwhile.
- Drafts and changesets of the editor made before such a change can become unusable; the PR tells their owner.
- Later changes have less to keep in step, and no rule or tolerance to please.
- From v1 on, compatibility needs a new decision.
