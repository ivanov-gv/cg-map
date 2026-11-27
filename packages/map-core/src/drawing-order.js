// The basemap's drawing order, bottom to top, from the wiki page UI 3.Core. A bridge deck lies above the canyon, water,
// ground and roads at or below ground level, but below roads whose own tags put them on a bridge. Every basemap layer
// belongs to exactly one group, and the style lists the groups in this order.
// One corner-case override, which the wiki allows: slope tones come before canyon walls, water and buildings. The
// riverbanks of the Morača are parks, so slopes drawn after the walls would cover them; slopes lie only inside green
// areas, so drawing them under water and buildings changes nothing else.
export const drawingGroups = [
  'land',
  'shaded-slopes',
  'sunlit-slopes',
  'canyon-walls',
  'canyon-rims',
  'water',
  'buildings',
  'meadows',
  'contour-lines',
  // Ground and lower roads come before decks so a road passing under a bridge cannot cover its deck.
  'streets',
  'trails',
  'main-routes',
  'stairways',
  'bridges',
  // Tracks still cover land use and decks. Roads on bridges stay above tracks; ground roads now pass below them.
  'railways',
  'bridge-streets',
  'bridge-trails',
  'bridge-main-routes',
  'bridge-stairways',
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
