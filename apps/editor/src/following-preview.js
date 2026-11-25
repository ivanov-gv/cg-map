// What goes along with the open edit, shown on the map before Apply: the roads of a moved junction, the entrances of a
// moved building, the sea beside a moved coast.

// Finding it must not hold up a drag. When it took longer than this, the drag goes on alone and it is shown at its end.
const slowestWhileDraggingMilliseconds = 40;
// A moment later the same question can be quick, because the layer has prepared what it needs.
const measurementsKept = 3;

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

export class FollowingPreview {
  #durations = [];

  get #isSlow() {
    const isMeasured = this.#durations.length >= measurementsKept;
    return isMeasured && Math.min(...this.#durations) > slowestWhileDraggingMilliseconds;
  }

  // What follows now, or nothing while a drag would have to wait for it. find() gives {problem, shapes, ghosts}.
  of(find, isDragging) {
    const isSkipped = isDragging && this.#isSlow;
    if (isSkipped) return {problem: null, shapes: [], ghosts: []};
    const start = performance.now();
    const found = find();
    this.#durations = [...this.#durations, performance.now() - start].slice(-measurementsKept);
    return found;
  }

  forget() {
    this.#durations = [];
  }
}
