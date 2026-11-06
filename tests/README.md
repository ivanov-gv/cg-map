# Cross-component integration

- integration/: archive/rendering/data contracts and transport behavior across component boundaries.
- Browser acceptance lives with each browser project, against its own artifact at origin root and project prefix. See
  [web testing](../apps/web/AGENTS.md#testing).

Component-specific tests live with their components. Run make check and make verify PKG=tests from the root. Browser
tests do not establish phone GPU performance or long-term storage retention.
