# Cross-component acceptance

- integration/: archive/rendering/data contracts and transport behavior across component boundaries.
- e2e/: Playwright against the assembled dist/web artifact, at origin root and project prefix.

Component-specific tests live in apps/web/tests, data/tests, platform/tests, and services/backend. Run make check and make test-e2e from the root. Browser tests do not establish phone GPU performance or long-term storage retention.
