# Shared formats

Read [README.md](README.md). This is a published package: the repository version is `0.0.0-dev`, and consumers pin an
exact release. A contract change updates producer validation, `tests/` and the following release together; do not add
relative contract paths outside this folder, data and the shared tests helper. Before v1, replace a wrong format instead
of keeping it readable ([decision 0039](../../docs/decisions/0039-strong-foundation-before-v1.md)); released versions
never change. Do not import UI, backend, or data-pipeline code here.
