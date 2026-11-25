// What goes along with the open edit, shown on the map before Apply: the roads of a moved junction, the entrances of a
// moved building, the sea beside a moved coast.
const hasPlace = feature => Boolean(feature?.geometry?.coordinates?.length);

// The shapes of edits as they would be, and as they are: {shapes, ghosts}. Edits that move nothing are left out.
export function followingShapes(edits, workingFeature) {
  const moved = edits
    .map(({filename, key, after}) => ({before: workingFeature(filename, key), after}))
    .filter(({before, after}) => JSON.stringify(before?.geometry) !== JSON.stringify(after?.geometry));
  return {
    shapes: moved.map(({after}) => after).filter(hasPlace),
    ghosts: moved.map(({before}) => before).filter(hasPlace)
  };
}
