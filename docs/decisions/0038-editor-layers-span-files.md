# 0038: Editor layers span source files

## Status

Accepted. Replaces "one source file equals one editing mode" from the [editor plan](../plans/internal-layer-editor.md),
the Preview toggle of [ADR 0012](0012-editor-layer-switch-dialog-and-shortcuts.md) and the colours of
[ADR 0013](0013-editor-guides-at-neighbourhood-scale.md). Implements #406.

## Context

The wiki's Editor page lists ten layers by what people edit, not by file. A building, its entrances, its address and the
places inside are four files; a border and its municipalities are three. One mode per file made such an edit several
transactions in several modes, and a half-finished one blocked the export. The page also says an applied change shows on
the map at once, while the editor showed it only in its own mode or in a separate preview.

## Decision

- **A layer names its files** in `editor-layers.js`: those whose objects can be picked, and linked ones that change only
  with them. Exactly one layer is active. A command can reach only the active layer's files.
- **A step is a list of edits** across those files, undone as a whole. History is per layer. A step can be undone only
  while everything it wrote still stands, so undoing on one layer never drops a later edit from another. An imported
  changeset names its own files: it is one step in the history of every layer it touches, taken back whole from any.
- **Derived kinds** (country, neighbours, ocean) are drawn and never picked.
- **Every applied change stays on the map** in public cartography, in every layer and in Browse. The preview is gone.
- **Move, corners and drawing are modes** that shrink the inspector to one bar; new objects open their form when their
  shape is done. At widths up to 720 px drawing uses a fixed cross and deleting only marks.
- **Field items** (marks, later sketches and notes) live beside the edits: in the draft and in the exported file, never
  in an operation.

## Consequences

Cross-file edits are one reviewable step. A draft from before this change keeps its edits; its history is readable only
under its file name, so it cannot be undone step by step. Browse now draws changed files from their working features, so
an invalid saved draft reports its problem at once. The object list has no toolbar button of its own and opens from
Tools.
