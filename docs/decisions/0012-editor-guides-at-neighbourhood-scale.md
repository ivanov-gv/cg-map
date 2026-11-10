# 0012: Editor guides at neighbourhood scale

## Status

Accepted.

## Context

Issue #44 replaces source overlays that obscured public symbols and names. Revealing every source point with an edit
ring made city views unreadable. Hiding only the rings while retaining source hit targets would allow taps on objects
that the map does not show.

## Decision

Render the active file's working features with the published map styles, independently of optional hollow edit guides.
Use green for unchanged objects, amber for applied changes, and a separate blue outer selection outline. Keep names and
icons above the guides. Read-only stops and country outlines have normal inspection symbols or outlines of their own.

Show edit guides only from zoom 15, the shared policy's neighbourhood threshold. At that scale, guides may reveal source
POIs below their public threshold. At city scales, and whenever Tools turns guides off, select only objects returned by
the normal rendered map layers. Hidden guides and transparent polygon interiors are never independent hit targets. Keep
an open selection and its temporary geometry outline available even when guides are hidden.

## Consequences

City views remain readable and retain the public visibility policy. Inspecting a below-threshold POI requires zooming to
neighbourhood scale with guides enabled. This avoids a clustering policy or a second density index; dense guides at
closer zooms can still be turned off. Normal label collision rules still apply. The current preview limitations below
street scale remain, and this decision does not change when edits appear outside the active source mode.
