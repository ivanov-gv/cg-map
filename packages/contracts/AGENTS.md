# Shared formats

Read [README.md](README.md). This is a published package: the repository version is `0.0.0-dev`, and consumers pin an
exact release. A contract change updates producer validation, `tests/` and the following release together; do not add
relative contract paths outside this folder, data and the shared tests helper. Preserve compatibility or introduce a new
version for breaking changes. Do not import UI, backend, or data-pipeline code here.
