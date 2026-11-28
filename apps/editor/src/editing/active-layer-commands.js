import {layerFiles} from '../layers/shared/editor-layers.js';

// The one path for every edit made in a layer. Forms, keyboard, geometry tools and history can only reach the active
// layer's files, and with no active layer they cannot reach anything. Importing a reviewed changeset is the one
// deliberate exception, because a changeset names its own files.
export function createActiveLayerCommands(session, activeLayer) {
  const requireActiveLayer = () => {
    const layer = activeLayer();
    if (!layer) throw new Error('No layer is active.');
    return layer;
  };
  return {
    // Edits are {filename, key, after}. Together they are one undoable step.
    recordEdits(edits) {
      const layer = requireActiveLayer();
      const allowedFiles = layerFiles(layer);
      const foreignEdit = edits.find(({filename}) => !allowedFiles.includes(filename));
      if (foreignEdit) throw new Error(`${layer.name} cannot change ${foreignEdit.filename}.`);
      return session.recordEdits(layer.id, edits);
    },
    undo: validate => session.undo(requireActiveLayer().id, validate),
    redo: validate => session.redo(requireActiveLayer().id, validate)
  };
}
