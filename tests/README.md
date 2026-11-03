# Cross-component integration

- integration/: archive/rendering/data contracts and transport behavior across component boundaries.
- Browser acceptance lives with its owner in [apps/web/tests/e2e](../apps/web/tests/e2e), against the assembled dist/web
  artifact at origin root and project prefix. See [web testing](../apps/web/AGENTS.md#testing).

Component-specific tests live with their components. Run make check and make verify PKG=tests from the root. The legacy
make -C tests e2e target forwards to web; make test-e2e remains the root browser entry point. Browser tests do not
establish phone GPU performance or long-term storage retention.
