# Task: Web command and browser-test ownership

Status: complete

## Goal and acceptance criteria

- Own frontend command implementations, Playwright configuration, browser journeys, and browser dependencies in
  apps/web. Keep root npm and Make entry points as forwarding commands or repository-wide aggregators.
- Preserve both browser projects, all assertions, root command compatibility, per-worktree ports, and the shared root
  workspace lockfile. Do not change application behavior, regenerate geography, or tune test concurrency/timeouts.
- Preserve existing documentation edits, including unrelated UI/UX work present when this task started.

## Decisions

- Browser acceptance of the assembled web artifact belongs to web, including mocked server-mode and offline journeys.
  Cross-component data and producer/consumer tests stay in tests/integration. Update ownership documents accordingly.
- Keep the private root package.json and package-lock.json for workspaces and shared tooling. Move Playwright's pinned
  dependency and frontend scripts to the existing web workspace.
- Resolve fixture and artifact paths from test file locations. Keep browser output inside apps/web and update CI's
  failure-evidence path. Standalone test commands build first; aggregate checks can reuse their explicit web build.

## Progress

- Completed: moved the browser suite/configuration; made web own commands and Playwright; updated root/CI forwarding,
  fixture paths, documentation, lockfile, and generated adapters. Root/workspace discovery retains all 50 cases. Fixed
  color-enabled worker port parsing and added forwarding/error-propagation/port regression checks.
- Completed: root static-preview smoke check and standalone web workspace test command.
- Remaining: none.
- Blockers: none.

## Verification

- Baseline: complete frontend CI job 6m 38s; browser acceptance 49 passed with one expected desktop touch skip.
- Passed: clean pinned dependency installation, web component verification (48 Node tests), platform verification,
  root/workspace filtered discovery, all 50 browser cases discovered, and GitHub Actions lint.
- Passed: four focused desktop/mobile map and update journeys (22s), after correcting the worker port parsing issue.
- Passed: make check (48 web Node tests, 40 other Node tests, five Python tests; 11.40s); root static-preview smoke
  check; standalone workspace test command (48 passed); full root make test-e2e (49 passed, one expected desktop touch
  skip; 310.34s including its build).
- Application runtime, reviewed data, and browser settings are unchanged. Browser assertions were preserved.
- Passed: independent compliance review; no findings. Hosted CI/deployment has not been run in this session.

## Handoff

- No commits or deployment requested. Retain root aliases and document component-local commands.
