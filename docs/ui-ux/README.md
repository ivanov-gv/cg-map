# UI/UX, user stories, and user success

This folder owns the product experience for **Discover → Understand → Plan → Travel**: user intent, visible behavior,
success criteria, and acceptance scenarios. Start with the journey and maintained capabilities in
[user stories](user-stories.md).

| Document                                    | Purpose                                                                                      | Status                                                            |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [User stories and success](user-stories.md) | Journey, capabilities to maintain, observed UI gaps, and user-research measures.             | Implemented baseline, with links to separate target requirements. |
| [Laconic interface](interface.md)           | Map-first controls, a stable expanding dock, minimal wording, and a reusable design brief.   | Implemented in web source; physical-device checks pending.        |
| [Discover](discover.md)                     | The default map: movement network, buildings, terrain, relevant POIs, and current position.  | Target requirements; implementation gaps are explicit.            |
| [Understand](understand.md)                 | One deliberate selection reveals the object's available details and geographic context.      | Target requirements; implementation gaps are explicit.            |
| [Plan](plan.md)                             | Context views, From/To, mode-specific routes, relevant path choice and readiness for Travel. | Target requirements; implementation gaps are explicit.            |
| [Travel](travel.md)                         | Live GPS/device position against the selected route, progress, recovery and completion.      | Target requirements; implementation gaps are explicit.            |

Discover supplies the visible scene. Understand explains a selected object or point. Plan begins only with a separate
intention to organize a journey; Travel concerns acting on that plan. [Plan](plan.md) now defines context views,
endpoint/mode selection, calculation and the readiness handoff; [Travel](travel.md) defines live position against the
chosen route, progress, recovery and finishing. Existing routing behavior remains documented in the
[routing implementation guide](../routing.md), distinct from the target requirements.

Use the stage requirements to assess a proposed experience, and the baseline to preserve existing useful capabilities.
Use the interface specification for control placement and wording, including fixed categories and compact mobile search.
It revises Discover's earlier automatic-key and location banner presentation without removing geographic content or
honest state. An approved target is not a claim that data, UI, or acceptance tests already fulfill it. Keep requirement
IDs stable when refining a stage; name the affected requirements, user-visible improvement, data dependencies, and
evidence in implementation plans.

Implementation truth remains in [architecture](../../ARCHITECTURE.md), [ownership](../ownership.md),
[point selection](../point-selection.md), and the [frontend guide](../../apps/web/README.md). Verification commands and
device limitations remain in [testing](../testing.md). Do not duplicate those engineering details here or introduce a
service just to describe a user need.
