# Shared map runtime

Read [README.md](README.md), [JavaScript](../../docs/engineering/javascript.md), [UI](../../docs/engineering/ui.md), and
[readability](../../docs/engineering/readability.md).

- Runtime imports only sibling package modules and consumes injected engines, URLs and data. No application, pipeline,
  backend, storage or service-worker imports. Export reusable capabilities through src/index.js.
- This package is a contract for every map application. tools/ and assets/ are part of it; keep them free of any one
  application's knowledge. Tests read shared formats from the exact `@ivanov-gv/map-contracts` devDependency; runtime
  src/ never imports contracts.
- Keep source GeoJSON immutable; source identity and editing permissions belong to consumers.
- New capabilities need a control in apps/core-demo and consumer coverage. Preserve the public app's offline module
  inventory.
- This is a published package: apps/web and apps/editor pin a release, so a change here reaches only apps/core-demo
  until it is [released](../../docs/runbooks/release.md#releasing-map-core) and they upgrade. Treat what src/index.js
  and tools/ export as a public API: a breaking change needs a major version.
- Local `make verify PKG=packages/map-core` and `make -C apps/core-demo e2e` are optional for iterating; GitHub's
  map-core and consumer pipelines gate the merge. Review both deployment prefixes and the concept app manually while
  iterating.
