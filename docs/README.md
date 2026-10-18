# Engineering documentation

See [team ownership](ownership.md). Start with [current architecture](../ARCHITECTURE.md) and [agent instructions](../AGENTS.md).

| Need | Document |
| --- | --- |
| Setup and checks | [Development](runbooks/development.md) |
| UI implementation | [Frontend guide](../apps/web/README.md) |
| Data contracts and rebuilding | [Data runbook](runbooks/data.md) |
| Publishing, Pages migration, rollback | [Release runbook](runbooks/release.md) |
| Live bus feed and release gate | [Transport](transport.md) |
| Test commands, evidence, device checks | [Testing](testing.md) |
| Why source/output/docs are separate | [ADR 0003](decisions/0003-concern-monorepo-and-actions-pages.md) (current) |
| Multi-session task state | [Plan template](plans/TEMPLATE.md) |
| Known gaps | [Technical debt](technical-debt.md) |
| Detailed design and future options | [Implementation guide](design/implementation-guide.md) |

Update documentation in the same change as affected behavior. Current architecture and runbooks take precedence over historical verification notes. Keep each fact in one authoritative location; link instead of duplicating.

- [Point selection](point-selection.md): feature details and From/To endpoint state.
