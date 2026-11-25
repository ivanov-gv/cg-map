# Platform and release tooling

Read [README.md](README.md) and [release runbook](../docs/runbooks/release.md). Publish only dist/web; never upload the
repository or source datasets as Pages content. Keep deployment write permissions in the deploy job. Do not clear
origin-wide caches or OPFS in compatibility migrations. CI publishes a dev `@ivanov-gv/map-contracts` package for
contract changes and cd-map-contracts promotes a release; platform tooling tests use that exact pin. Platform owns the
shared ESLint rules in eslint-rules.mjs; project configs choose their own patterns and globals, and the rules name no
project file.
