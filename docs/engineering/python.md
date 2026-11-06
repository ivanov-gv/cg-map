# Python conventions

Applies to `*.py`: data pipeline tools (data/tools), platform servers and packaging (platform/tools), the web
browser-test server (apps/web/tests/e2e), and their tests. Python 3.12.

## Python code

- New and substantially edited code follows PEP 8 with four-space indents, one import per line, and standard library
  imports first. Some legacy pipeline scripts use a compact style; do not reformat them as part of an unrelated change.
- Resolve repository paths from `Path(__file__).resolve().parents[n]`, never from the current working directory.
- Use `argparse` for command-line options and print a short summary of what was written.
- Exit non-zero with a clear message on invalid input; do not write partial outputs over reviewed sources.

## Geodata

- Coordinates are WGS84 `[longitude, latitude]`, rounded to 6 decimals where existing tools do. Polygon rings stay
  closed.
- Preserve provenance fields, attribution, and source identity. Do not invent stable IDs for legacy geometry (see
  [data/AGENTS.md](../../data/AGENTS.md)).
- Outputs must be reproducible: sort keys and features deterministically and avoid timestamps inside generated data
  unless provenance requires them.

## Python dependencies

- Platform tools and tests use the standard library only, so `make check` runs without a virtualenv.
- Geography tools may use the packages pinned in data/tools/requirements.txt. Add a dependency only by pinning it there.

## Tests and checks

- Tests use `unittest` and live in `<component>/tests/test_*.py`.
- Enforced: `python3 -m py_compile` on platform/tools, data/tools, and apps/web/tests/e2e, plus the platform unittest
  suite, in `make check`.
- Verify: `make verify PKG=<component>`, then `make check`. Geometry changes also need `make -C data build-data`.
