# UI/UX: from user need to feature

This area connects **why someone needs a capability** to **what the interface does**. Follow the documents in this
order:

1. Start with [user stories](user-stories/README.md) for user goals, maintained outcomes, and target journey
   requirements.
2. Use [features](features/README.md) to see which existing interface behavior serves each story, and where that
   behavior is implemented or remains a target.

The journey is **Discover → Understand → Plan → Travel**. The stories folder contains the outcome baseline and stage
requirements; the features folder contains current user-visible behavior and its story rationale. Every feature must
name the story IDs it serves. Do not retain a control or behavior as an unexplained implementation detail: identify the
user outcome it supports, or propose a story update when a genuinely new need is established.

Story baselines and target requirements are distinct from implementation truth. See the
[system architecture](../system-architecture/README.md), the owning component's documentation, and
[verification guidance](../verification/README.md) for implementation boundaries and evidence. Approved targets do not
claim that data, UI, or tests already fulfill them.

Interface proposals for the internal source editor, a maintainer tool outside this journey, live in
[editor](editor/README.md).
