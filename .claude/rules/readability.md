---
description: Readability (generated from docs/engineering/readability.md)
paths:
  - "**/*.go"
  - "**/*.js"
  - "**/*.mjs"
  - "**/*.py"
  - "**/*.sh"
  - "**/*.css"
  - "**/*.html"
  - "**/*.proto"
  - "**/Makefile"
  - "**/*.mk"
  - "platform/git-hooks/**"
  - ".github/**/*.yml"
---

<!-- GENERATED from docs/engineering/readability.md
by platform/agents/gen-agent-rules.mjs. Do not edit; run `make agent-rules`. -->

# Readability

Applies to all code in this repository: every language, tests, scripts, and tooling. A reader who has never seen a file
must be able to understand it by reading it once, top to bottom. Language guidelines add idioms; they do not relax this.

## Names

A name carries the meaning of the code. If the reader needs the surrounding code or the author to know what a name
means, the meaning is hidden and the name is wrong.

- Name the concept at the level the code works at. Shared code uses the general idea, and a concrete case appears only
  where the code depends on it. Shared transport code says `vehicle`, because a bus is one example; only a layer
  specific to a bus source says `bus`. Test: if another kind were added, would this name become wrong?
- Never use two words to encode a difference. `vehicle` and `bus` for "current" and "remembered" hides that difference;
  `vehicle` and `previousVehicle` states it.
- Name a value after what it means to the reader, not after its format or mechanism. A list of buses is `vehicles`, not
  `items`.
- Wire formats keep their names. JSON keys, protobuf fields, schema terms, and the types that mirror them follow the
  contract. Keep those types at the boundary that speaks the format; domain code uses domain types.
- Use whole words: `previousVehicles`, not `prev`; `directory`, not `dir`. Allowed short names: `ctx`, `err`, `w`, `r`,
  and `t` in Go, method receivers, the tile coordinates `z`, `x`, `y`, and `got`/`want` in tests.
- Give one thing one name within a component, and different things different names. Raw provider rows are
  `UpstreamVehicle`; normalized ones are `vehicles`.
- Put the unit in the name when the type does not carry it: `maxSpeedMetresPerSecond`, `distanceMetres`.
- Booleans read as facts: `isMatched`, `hasExtension`. Functions say what they return or do: `distanceMetres`,
  `parseQuality`, not `calc` or `handle`.

## Structure

- A function reads as a short sequence of steps at one level of detail. Move a self-contained step into a named function
  when the function runs past about 60 lines or nests more than three levels. Tables and declarative lists do not count,
  and a linear test scenario may run longer when splitting it would hide its order of events.
- Handle failures and special cases first with early returns, so the main path stays unindented.
- Give a complex expression or condition a named local variable, one thought per name:

  ```go
  // hard to read
  if len(r.Vehicles) != 1 || r.Stale != want || r.SourceUrl != source {
  // readable
  isExpectedSnapshot := len(r.Vehicles) == 1 && r.Stale == want && r.SourceUrl == source
  if !isExpectedSnapshot {
  ```

- Name every number or string whose meaning is not obvious at the use site. A byte layout from a specification can stay
  numeric when one comment names the specification.
- One statement per line, including in JavaScript and Python. Density is not a virtue.
- Do not add a helper only to name a one-line expression used once; use a local variable.

## Comments

- Every type and non-trivial function says what it returns or guarantees, and what callers must assume.
- Comments explain why and state rules the code cannot show: a limit's reason, a compatibility requirement, a surprising
  order of operations. Do not restate the code.
- Update comments in the same change as the code they describe.

## Applying this to changes

- All code you add or change meets these rules, and so does the rest of any function you substantially edit.
- Do not reformat unrelated code in the same change; a dedicated readability change is a separate task.
- A rename reaches every use in the component: tests, error messages, log prefixes, comments, and docs.
- A readability change preserves behavior. It does not change wire formats or user-visible text, and it never deletes,
  skips, or loosens a test.

Outside services/backend, no hook, lint rule, or CI check enforces this guideline. In services/backend, golangci-lint
enforces part of it: names under three characters used beyond a few lines, functions over 60 lines, `if` nesting and
overall cognitive complexity, most unnamed numbers outside tests, and comments on exported names. Everything else stays
with the compliance review, which depends on the agent running it: whether a name is meaningful, abbreviations such as
`prev`, exact nesting depth, and numbers in tests.
