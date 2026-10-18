# Team boundaries

These are logical ownership boundaries, not claims that these teams already exist. Today @ivanov-gv is the bootstrap CODEOWNER; substitute real team handles as people join.

| Team | Owns now | Future scope | Published interface |
| --- | --- | --- | --- |
| Web experience | apps/web | Richer map UX, accessibility, client performance, offline navigation UI | Built static app; consumes published datasets/contracts |
| Backend and editorial | services/backend | Listings/editing/moderation, identity/permissions, online search APIs | Versioned APIs and events once implemented |
| Map data | data | Source ingestion, conflation, quality, imagery, tiles, regional releases | Checksummed releases and published place/tile schemas |
| Platform and reliability | platform, .github | Environments, observability, deployment, security boundaries, recovery | Build/deploy workflows and operational tooling |
| Shared stewardship | packages/contracts | Compatibility across data, API, and clients | Versioned schemas; producer and consumer approval |

## Collaboration rules

- Web consumes data artifacts; it does not run OSM imports or depend on backend internals.
- Data uses shared schemas rather than importing UI implementation.
- Backend can build and test independently. Static hosting is its only current implementation; do not create placeholder microservices.
- Platform runs domain-owned build/check commands and manages deployment permissions. It does not own product semantics.
- Shared contract changes need affected producers and consumers reviewed together. Document breaking changes and migration paths.
- Cross-component tests live in tests/. Local tests and instructions live with their component.

## When to split teams further

Split backend/editorial into directory operations and serving/search when their release cadence, workloads, or ownership diverge. Split map data into acquisition/quality and tile delivery when pipeline scale warrants it. Routing/navigation is a separate domain once there is a real routing product, graph, and runtime; display roads do not provide routing.

Keep those as decisions triggered by evidence. Do not scaffold unused services or empty team folders now.
