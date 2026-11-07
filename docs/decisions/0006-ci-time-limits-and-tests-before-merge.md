# 0006: Tests before merge, job time limits and a decisions log

## Status

Accepted.

## Context

A merge to main ran the same tests its PR had just passed, then published. `main` requires `CI gate` on a branch that is
up to date with it, and nobody can bypass that, so a merged commit has the same content the PR tested. One editor job
took 13 minutes, and long jobs were slowing everyone who waited on them. Separately, plans were being deleted or kept by
guesswork, and nothing said which PRs should leave a record of what they decided.

## Decision

- **Tests run before merge, and nightly.** A push to main runs no checks: it only publishes what changed and updates the
  dev environment. The nightly run checks everything on main.
- **No merge until local tests pass.** A change to `.github/**` passes under `act` first, inside the job limits, on an
  image with the browser already installed. A run on GitHub does not replace this.
- **A job aims for 5 minutes and stops at 7.** `timeout-minutes` enforces 7 on every job, and a test enforces that. A
  job over 5 minutes gets a warning, and is split rather than given more time.
- **Work goes task, plan, PR, decisions log.** A plan stays until its work is finished, however many PRs that takes. A
  PR that makes or implements an important decision adds the next numbered record to this folder. A PR that does not
  says so in its description. A check fails on a gap or a repeated number.

## Consequences

- Browser tests on a PR cover only the areas it maps to, so a wrong mapping can reach the dev environment and stay there
  until the nightly run, up to a day later. There are no users on it yet. Before there are, this needs revisiting.
- Publishing rebuilds from main instead of reusing the artifact a PR tested, because squash merging gives main a new
  commit. The content is the same, and a tool version could still differ.
- A failed nightly run does not stop later merges from publishing. Someone has to read it.
- Parallel PRs taking the same record number collide: the second is out of date after the first merges, and fails the
  check once updated, so it takes the next number.
- A suite that outgrows a job needs another job, which uses more runner time in total than one long job.
