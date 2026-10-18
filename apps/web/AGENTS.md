# Web application

Read [README.md](README.md), [architecture](../../ARCHITECTURE.md), and [contracts](../../packages/contracts/README.md).

- src/ owns runtime JavaScript; public/ owns HTML/CSS/icons/fonts/vendored bundles.
- tools/ assembles the app with published data into dist/web; do not commit generated output.
- Data inputs belong to data/, not this component. Consume its release and shared contracts.
- Keep core.js free of DOM/browser state. Preserve one map instance and local runtime assets.
- Keep archive/range responses outside shell caching and preserve verified downloads on failed replacements.
- Use relative paths so the built app works at / and /cg-map/.
- From the root, run make check and make test-e2e after web/offline changes. npm test in this workspace builds the artifact before local web tests.
