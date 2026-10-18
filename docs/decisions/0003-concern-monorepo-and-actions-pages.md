# ADR 0003: Concern-based monorepo and artifact deployment

Date: 2026-10-18. Status: accepted. Supersedes ADR 0002's flat web layout and root Pages entry.

## Decision

Separate web experience, backend/editorial, map data, platform, and shared formats by ownership. Use apps/web and data npm workspaces and an independent services/backend Go module. Keep component-local tests beside implementation and cross-component tests under tests/.

Data is a producer: reviewed sources/imagery and a checksummed archive release belong to data/. Web consumes that release and shared contracts. It does not own a copied dataset or import pipeline implementation. packages/contracts is the compatibility boundary; category agreement is tested.

Build a disposable dist/web artifact from these inputs. GitHub Actions tests and uploads that artifact, then deploys it to Pages with minimal job permissions. No app assets, deployment redirects, or Go modules remain in repository root. Old /web/ entry points are compatibility files within the artifact.

## Consequences

Teams have independent source/test ownership and the backend can build without npm/data. Root orchestration supports cross-component validation. The current backend is still only a static host; future APIs and further team/service splits require actual requirements.

Committed reviewed map artifacts keep web builds practical. Large future datasets should move to immutable artifact storage behind the same release contract. Building web does not regenerate geography.
