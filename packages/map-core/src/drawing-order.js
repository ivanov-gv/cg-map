// The basemap's drawing order, bottom to top, from the wiki page UI 3.Core. Canyon walls and rims sit between land and
// water, and bridges right above streets, as the Penpot city-centre rules place them. Every basemap layer belongs to
// exactly one group, and the style lists the groups in this order.
export const drawingGroups = [
  'land',
  'canyon-walls',
  'canyon-rims',
  'water',
  'buildings',
  'shaded-slopes',
  'sunlit-slopes',
  'meadows',
  'contour-lines',
  'streets',
  'bridges',
  'trails',
  'main-routes',
  'stairways',
  'labels',
  'points-of-interest'
];

// Layer metadata is free-form in the MapLibre style specification; this key keeps the group visible to tests and to
// applications that insert their own layers relative to a group.
export const drawingGroupKey = 'map-core:drawing-group';

// Returns the layer with its drawing group recorded. Throws for an unknown group, so a typo cannot silently put a
// layer outside the order.
export function inDrawingGroup(group, layer) {
  if (!drawingGroups.includes(group)) throw new Error(`Unknown drawing group: ${group}`);
  return {...layer, metadata: {...layer.metadata, [drawingGroupKey]: group}};
}
