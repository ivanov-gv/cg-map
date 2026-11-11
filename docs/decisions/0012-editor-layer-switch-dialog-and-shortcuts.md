# 0012: Editor layer switch dialog and keyboard shortcuts

## Status

Accepted.

## Context

Switching layer modes with an unapplied edit — typed details or a geometry preview — had two different behaviors: typed
details blocked the switch with a status message, while geometry previews were dropped silently. Both outcomes risk data
loss: the user may not notice the status message, and a silent drop loses work without warning. Additionally, undo and
redo required clicking buttons in the Tools panel, with no keyboard shortcuts.

## Decision

- **Three-way modal dialog for mode switches**: When the user attempts to switch modes, enter Browse, or toggle Preview
  with an unapplied edit, a native HTML `<dialog>` opens with three options: **Apply** (commit and proceed), **Discard
  edit** (clear and proceed), and **Keep editing** (cancel and stay). This replaces the status-message refusal for typed
  details and the silent drop for geometry edits.

- **Apply validation feedback**: If Apply is chosen and validation fails, the dialog closes, the inspector is shown
  (opening it if collapsed), and focus moves to the problem message. The user stays on the current mode with the edit
  intact.

- **Escape priority order**: Escape follows a strict hierarchy: (1) cancel active drag gesture, (2) dismiss the layer
  switch dialog (defaulting to "Keep editing"), (3) collapse the inspector when focus is inside it, (4) close the
  foremost utility panel, (5) collapse the inspector when focus is elsewhere. The dialog's `cancel` event is caught to
  prevent the browser from closing it without running the "Keep editing" logic.

- **Public InspectorEditing API**: The private `#apply()` and `#cancel()` wrapper methods were removed. The public
  `applyEdit()` (returning `{success, problem?}`) and `discardEdit()` are called directly by the dialog handlers and the
  inspector form submit/cancel buttons.

- **Workspace undo/redo keyboard shortcuts**: `Ctrl/Cmd+Z` triggers undo, `Ctrl+Y` and `Ctrl/Cmd+Shift+Z` trigger redo.
  Shortcuts check that undo/redo is enabled (button not disabled), ignore IME composition, and do nothing when focus is
  inside text controls (`input`, `textarea`, `select`, `[contenteditable="true"]`). The Tools panel displays platform-
  specific shortcut hints.

## Consequences

- Users no longer lose unapplied edits silently when switching modes.
- The dialog blocks all map interactions until dismissed, requiring focus trap (handled natively by `<dialog>`).
- Escape during an active drag still cancels only the gesture, not the dialog or inspector.
- Keyboard shortcuts improve workflow speed but are scoped to avoid interfering with text editing.
- The existing `selectFeatureAtClick` guard (`hasUnappliedEdit`) still shows the status message for stray clicks,
  providing a secondary safety net.
