import {isLayerObject} from '../shared/editor-layers.js';
import {featureForEntry} from './layer-junctions.js';
import {entryOnShownLevel, jointOnShownLevel, layerJoints} from '../shared/layer-joints.js';
import {jointMinZoom} from '../shared/joint-layer.js';
import {sourceEntriesForHits} from '../../source-data/source-overlay.js';

// The editor host's roads rules. app.js and the component harness call these instead of each keeping a copy: a broken
// level filter or click order then fails the same browser test whichever host mounts the layer.

// A derived or context-only file is drawn for context but never picked.
export const isPickableEntry = (entry, layer) =>
  isLayerObject(entry.filename, entry.feature) && !layer?.contextFiles.includes(entry.filename);

// The junctions to draw at this zoom, keeping only those on the one shown level.
export function roadsJointsToShow({layer, bounds, context, shownLevel, zoom}) {
  const jointsOfLayer = layerJoints[layer?.id];
  if (!jointsOfLayer || zoom < jointMinZoom) return [];
  return jointsOfLayer.joints(bounds, context).filter(joint => jointOnShownLevel(joint, shownLevel));
}

// The rendered entries a click may select, leaving out objects on another shown level.
export function roadsPickableEntries({hits, entries, layer, shownLevel}) {
  return sourceEntriesForHits(hits, entries).filter(
    entry => isPickableEntry(entry, layer) && entryOnShownLevel(entry, shownLevel)
  );
}

// A junction wins over the road under the same tap. hitsOf stays lazy so a junction tap needs no hit query.
export function roadsClickTarget({point, jointLayer, layer, context, entries, shownLevel, hitsOf}) {
  const joint = jointLayer.jointAt(point);
  const jointEntry = joint && layerJoints[layer?.id]?.entry?.(joint, context);
  if (jointEntry) return {entry: jointEntry, candidates: []};
  return {entry: null, candidates: roadsPickableEntries({hits: hitsOf(), entries, layer, shownLevel})};
}

// A junction has no working feature; every other entry opens the feature the session now holds.
export const roadFeatureForSelection = (entry, session) => featureForEntry(entry, session);
