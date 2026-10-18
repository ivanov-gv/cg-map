# ADR 0001: Repository-owned agent foundation and root Pages output

Date: 2026-10-18. Status: accepted.

## Context

The PoC duplicated application assets into docs/ and kept current architecture, historical evidence, and future proposals in one large guide. Agents need concise entry points, repeatable commands, verifiable boundaries, and recoverable task context.

## Decision

Keep web/ as application source and generate branch-based Pages output into inventoried root paths. Reserve docs/ for documentation. Make AGENTS.md a navigation and operating guide; keep current architecture concise and preserve the long design guide separately.

Use existing coding agents with repository runbooks, deterministic checks, and browser verification. Add orchestration and specialist workflows only when repeated failures or workload justify them. CI checks drift without silently rebuilding it away.

## Consequences

Source and generated output must be committed together. A publisher regression must never delete documentation or unrelated root paths. Tests exercise that boundary. Root Pages makes repository paths publicly addressable, so no secrets or private operational content belong in this public repository.

The owner must change Pages from /docs to / (root). A future Actions-based deployment could eliminate tracked runtime duplication, but is outside this branch-folder migration.

## Supporting experience

- [Tom Matthews / Nscale: Building Alfred](https://www.nscale.com/blog/building-an-ai-agent-for-modern-engineering-teams)
- [OpenAI: Harness engineering](https://openai.com/index/harness-engineering/)
- [Anthropic: Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Birgitta Böckeler: Harness engineering for coding agent users](https://martinfowler.com/articles/harness-engineering.html)
- [Evaluating AGENTS.md](https://arxiv.org/abs/2602.11988)

These inform the approach; they do not prove that a particular workflow improves this repository. Measure recurring failures, rework, review effort, and cost per accepted change before adding more process.
