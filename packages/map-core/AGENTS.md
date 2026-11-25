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
- This is a published package: releases and tests of apps/web and apps/editor pin one, and every other build of them
  takes this folder ([ADR 0037](../../docs/decisions/0037-builds-take-their-own-commits-packages.md)), so a merge here
  reaches the dev site. Both must keep working with the version they pin. Treat what src/index.js and tools/ export as a
  public API: a breaking change needs a major version.
- Local `make verify PKG=packages/map-core` and `make -C apps/core-demo e2e` are optional for iterating; GitHub's
  map-core and consumer pipelines gate the merge. Review both deployment prefixes and the concept app manually while
  iterating.
