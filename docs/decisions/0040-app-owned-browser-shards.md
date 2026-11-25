# 0040: App-owned editor browser shards

## Status

Accepted. Decided for issue [#458](https://github.com/ivanov-gv/cg-map/issues/458).

## Context

The platform planner used to name every editor source and spec in `EDITOR_BROWSER_AREAS` and `SHARED_EDITOR_SOURCES`. A
change picked a subset of those areas, and each area named its own spec files and job count. That duplicated the
editor's own knowledge of its tests: adding a spec or moving a file between areas needed a planner change, and a mapping
mistake could leave a spec unrun.

The whole editor browser suite took 2,457 seconds across 17 jobs in one green run, 2,680 seconds across 17 in another,
and 2,414 seconds across 16 in a third. Other measured runs took 2,344 and 2,311 seconds. Those jobs already split
individual specs into uneven areas, so moving to a single Playwright shard count is simpler and spreads the work by test
count. Ten shards give about 250 job-seconds before the saving from fewer setup jobs, within the seven-minute job limit
even though some shards take longer than others.

## Decision

Any change to an editor file runs all of the editor's browser tests. The editor owns `browser-jobs.json`, which holds
only a positive integer `jobs`, and `tools/browser-matrix.mjs`, which turns it into a Playwright shard matrix. The
platform planner selects the `apps-editor` folder and no longer exports editor areas, source lists or an editor smoke
matrix. A CI test run, an in-place editor workflow call and the static workflow test call pass `smoke: true`; the app
tool then runs only the first shard. A normal PR run uses all shards.

## Consequences

- Adding, removing or renaming an editor spec needs no platform change. Playwright discovers the tests in every shard.
- Every editor change pays for the whole browser suite, rather than only the areas an old mapping considered relevant.
  Ten jobs still fit the run's job budget and replace the former 16–17 jobs.
- A shard can be slower than another because Playwright divides tests by count, not duration. The seven-minute job limit
  makes that unevenness safe; the app's unit test checks the matrix, and a changed job count needs a local
  `E2E_WORKERS=2 E2E_PHONE=tagged npx playwright test --list --shard=i/N` check of every shard. Matching CI's workers
  matters: with one worker Playwright keeps a whole slow file in one shard, but with two it divides individual tests.
- Workflow test runs prove only the first shard. They do not replace the PR's full editor browser suite.
