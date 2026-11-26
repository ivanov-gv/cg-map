# 0040: App-owned editor browser shards

## Status

Accepted. Decided for issue [#458](https://github.com/ivanov-gv/cg-map/issues/458).

## Context

The platform planner used to name every editor source and spec in `EDITOR_BROWSER_AREAS` and `SHARED_EDITOR_SOURCES`. A
change picked a subset of those areas, and each area named its own spec files and job count. That duplicated the
editor's own knowledge of its tests: adding a spec or moving a file between areas needed a planner change, and a mapping
mistake could leave a spec unrun.

The timing comments removed with that table recorded job times at CI's two workers: editing desktop took 193, 189 and
270 seconds with three shards, with a measured 166-second maximum at five; editing mobile took 327 seconds with all
phone tests and was split into two 31-test shards; offline desktop took 209 seconds in one job; layers took 270, 230 and
130 seconds in three 11-test tagged shards; viewer took 220 seconds in one job and about 90 seconds per shard when split
three ways. Those comments preserved grouped times, not a per-test table.

The estimated slowest shard below uses those grouped times, the current test counts, and 60 seconds of setup. It is an
estimate, not a measurement. With 15 shards, Playwright's count-based split gives 10–11 tests per tagged shard and 16–17
with `phone_tests=all`; `--list` proves the split for both modes. The estimate is 230 seconds for the slowest tagged
shard and 282 seconds for the slowest shard with all phone tests: 300 seconds is the aim and 420 seconds the limit.
`browser-jobs.json` changes when a measured shard comes near the limit.

## Decision

An editor change runs the app's browser suite, including a regular in-place call of `ci-apps-editor.yml`. The editor,
not the platform planner, owns `browser-jobs.json` and `tools/browser-matrix.mjs`; the planner exports no editor areas,
source lists or matrix output. The regular call passes no `smoke` input, so PR, nightly and full-dispatch runs use the
app-owned shard count; only the separate workflow-proof call passes `smoke: true`. The current mechanism is in
[.github/TESTING.md](../../.github/TESTING.md), and the shard-count proof rule is in
[apps/editor/AGENTS.md](../../apps/editor/AGENTS.md).

## Consequences

- Adding, removing or renaming an editor spec needs no platform change. Playwright discovers the tests for each shard.
- A PR pays for the whole editor browser suite rather than the areas an old mapping considered relevant. Fifteen jobs
  replace the former 16–17 and stay inside the job limit by the estimate above.
- Shards are split by test count, not duration, so one can be slower than another. Matching CI's workers matters: with
  one worker Playwright keeps a whole slow file in one shard, but with two it divides individual tests. The app's unit
  test checks the matrix, and its instructions hold the count's proof.
- A smoke proof proves the workflow's jobs and steps, not the editor suite; its call sites are in
  [workflow testing](../../.github/TESTING.md#on-github).

## Outcome note: phone tag parser (issue #458, 26 November 2026)

Pending owner approval in the PR: `platform/tools/phone-tags.mjs` is the single narrow exception to the HEAD-read rule,
read only by platform's tag check and both apps' own unit tests; no runtime app imports it.

## Outcome note: web shards (issue #458, 26 November 2026)

Web now follows the same mechanism: its 24 shards are counted in
[apps/web/browser-jobs.json](../../apps/web/browser-jobs.json) and built by its own matrix tool; the platform planner
owns no web areas, source lists or matrices. The last green full runs put the slowest interface shards at 320 seconds
with 12 interface shards. At two workers, `--list --shard=i/N` with 24 shards gives 13–14 tagged tests and 16–17 tests
with all phone tests per shard; about 250 seconds including 60 seconds of setup is the estimate for the slowest. Regular
web calls use every shard, the nightly uses `phone_tests=all`, and only the separate workflow-proof call uses one shard.
