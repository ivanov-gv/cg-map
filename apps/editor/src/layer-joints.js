// The layers whose lines join each other, and how their joints are found, shown and opened.
import {canNameJunctions, junctionEntry} from './layer-junctions.js';
import {waterJointsIn} from './water-joins.js';
import {entriesWithin, jointsIn, levelsOf, roadLevel} from './road-graph.js';

const roadsFile = 'roads.geojson';
const nodesFile = 'road-nodes.geojson';
const waterFile = 'water.geojson';

// By layer: joints(view, context) gives [{coordinate, status}], entry(joint) what a tap opens if anything, levels(view, context) the
// levels there that can be shown alone.
export const layerJoints = {
  roads: {
    joints: (view, {entriesOf}) => jointsIn(view, entriesOf(roadsFile)),
    // Older rules cannot name junctions, so there is nothing to open.
    entry: ({coordinate}, context) => (canNameJunctions(context) ? junctionEntry(coordinate) : null),
    levels: (view, {entriesOf}) => [...new Set(entriesWithin(entriesOf(roadsFile), view).flatMap(({feature}) => levelsOf(feature)))]
  },
  water: {joints: (view, {entriesOf}) => waterJointsIn(view, entriesOf(waterFile))}
};

// The levels an object is on, by file. Files without levels are on all of them. Lights and crossings have no level of
// their own; nearly all of them are on the ground, and the junction shows those that are not.
export const levelsByFile = {[roadsFile]: levelsOf, [nodesFile]: () => [0]};

// What the map needs to know of them. A text is the only list that a style can search.
export function levelFacts({filename, feature}) {
  const levels = levelsByFile[filename]?.(feature);
  if (!levels) return {};
  return {levelKeys: `,${levels.join(',')},`, ownLevel: filename === roadsFile ? roadLevel(feature.properties) : 0};
}
