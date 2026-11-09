# 0011: Editor inspector focus and Escape

## Status

Accepted.

## Context

Issue #42 makes the selected-object inspector collapsible without discarding unfinished work. A utility panel may
coexist with the inspector on wide screens, and Escape also needs to interrupt a geometry gesture. Applying or
cancelling removes the inspector, so its focused control needs a new destination.

## Decision

Use an explicit Escape priority: interrupt a gesture first, then collapse the focused inspector, then close an open
utility panel, then collapse an unfocused inspector. Return focus to the actual panel opener, or its toolbar button when
the opener is no longer visible. Escape during IME composition is left to the input method. This bounded set of surfaces
uses explicit priority rather than maintaining a separate dismiss stack.

After a user applies, cancels or deletes an edit, move focus from the inspector to the updated status message. Only
keyboard-visible focus reveals the normally hidden status. Selecting another feature or changing modes does not move
focus through the edit transaction.

## Consequences

Focus follows the user's current task and preserves unfinished edits when panels are hidden. A new dismissible surface
must be added deliberately to the Escape priority and tested with the existing surfaces. The status must remain
focusable and continue to describe the active mode after the selection is cleared.
