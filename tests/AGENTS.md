# Cross-project integration

Read [README.md](README.md), [JavaScript](../docs/engineering/javascript.md) and
[readability](../docs/engineering/readability.md).

- This project exists to test the [contracts](../docs/system-architecture/architecture.md#independent-projects) between
  other projects, so it is the one project that may import their code. Add a test here only when it crosses a boundary;
  anything else belongs to the project it tests.
- Run `make verify PKG=tests`.
