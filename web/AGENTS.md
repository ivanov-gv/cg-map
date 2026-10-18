# Browser application

Read [the implementation guide](README.md) for detailed code behavior.

- Keep application source and static assets here; do not make root copies.
- Keep `core.js` independent of browser globals. Put DOM orchestration in `app.js`.
- Preserve one map instance; toggle layers without reconstructing the map.
- Keep PMTiles/range responses outside the shell service-worker cache.
- Use relative URLs so the application works at `/` and `/cg-map/`.
- Avoid introducing CDN scripts, remote fonts, or runtime provider credentials.
- After runtime changes: `npm run release:prepare`, `make check`, and `make test-e2e`.
- A Node VM test is not a browser test. Do not claim phone performance from either.
