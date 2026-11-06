# UI features and behavior

This folder owns the **what**: user-visible behavior and the user outcomes that justify it. Read the story baseline
first, then use this map to follow each need to its feature behavior.

| Feature                                    | User stories served                             | Purpose and status                                                                                                                                                 |
| ------------------------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Interface](interface.md)                  | US-02, US-03, US-06, US-10, US-11, US-12, US-13 | Search, nearby discovery, layers, journey-state continuity, offline action, recovery, and location controls; approved and implemented, with device checks pending. |
| [Stable POI visibility](poi-visibility.md) | US-02, US-03, US-04                             | Fixed per-place icon levels, cumulative appearance, independent labels, and overlap selection; implemented, with device density review pending.                    |
| [Point selection](point-selection.md)      | US-04, US-05, US-06                             | Inspect listings, buildings and their recorded entrances, and use the selected location as a journey endpoint; implemented.                                        |
| [Route planning](routing.md)               | US-06, US-07, US-08, US-11, US-12               | Compare available car, walking, and dated bus suggestions while preserving endpoints and explaining limits; implemented with explicit online/offline boundaries.   |
| [Live transport](transport.md)             | US-05, US-06, US-09                             | Inspect dated stops and optional live vehicle activity without inventing identity, direction, or arrival data; implemented.                                        |

Each feature guide names its supporting stories and explains the connection. When a behavior has no user-outcome
rationale, do not add it by default: establish and document a user need first. The feature guides describe current
behavior; target journey requirements remain in [user stories and journeys](../user-stories/README.md).
