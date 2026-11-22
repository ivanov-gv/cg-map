# Cross-project integration

Read [README.md](README.md), [JavaScript](../docs/engineering/javascript.md) and
[readability](../docs/engineering/readability.md).

- This project exists to test the [contracts](../docs/system-architecture/architecture.md#independent-projects) between
  other projects, so it is the one project that may import their code. Add a test here only when it crosses a boundary;
  anything else belongs to the project it tests.
- Read every data source, artifact and tool through [data-root.mjs](data-root.mjs). It uses repository `data/` at HEAD
  by default and honours `MAP_DATA_ROOT`. No other file here may build a repository data path; the repository check
  enforces this.
- A normal run tests data at HEAD. A release run tests the exact package being promoted with
  `make -C tests verify MAP_DATA_VERSION=<version>`; the Makefile installs that version and points the whole suite,
  including the web build, at it.
- Run `make verify PKG=tests`.
