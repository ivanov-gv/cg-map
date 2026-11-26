// The way a vehicle takes between two points along the roads. It is drawn for whoever edits a line; the data stores only
// the stops and turn points.
import {distanceMetres} from '../../geometry/geometry-measures.js';

const walkingKinds = new Set(['pedestrian', 'footway', 'path', 'track', 'cycleway', 'steps']);
const farthestRoadMetres = 150;
// Degrees of one cell of the point index: about 110 m north, 80 m east.
const cellDegrees = 0.001;
const searchedCells = [-1, 0, 1];

export const isDrivable = ({properties}) => !walkingKinds.has(properties.kind) && properties.motor_vehicle !== 'no';

const cellKey = ([longitude, latitude], east = 0, north = 0) =>
  `${Math.floor(longitude / cellDegrees) + east}/${Math.floor(latitude / cellDegrees) + north}`;

// A heap of [priority, value] with the lowest priority first.
class PriorityQueue {
  #heap = [];

  get size() {
    return this.#heap.length;
  }

  #swap(first, second) {
    [this.#heap[first], this.#heap[second]] = [this.#heap[second], this.#heap[first]];
  }

  push(priority, value) {
    this.#heap.push([priority, value]);
    let index = this.#heap.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.#heap[parent][0] <= this.#heap[index][0]) return;
      this.#swap(index, parent);
      index = parent;
    }
  }

  pop() {
    const [top] = this.#heap;
    const last = this.#heap.pop();
    if (this.#heap.length > 0) {
      this.#heap[0] = last;
      this.#sink();
    }
    return top[1];
  }

  #sink() {
    let index = 0;
    for (;;) {
      const children = [2 * index + 1, 2 * index + 2].filter(child => child < this.#heap.length);
      const smallest = children.reduce((best, child) => (this.#heap[child][0] < this.#heap[best][0] ? child : best), index);
      if (smallest === index) return;
      this.#swap(index, smallest);
      index = smallest;
    }
  }
}

// Every drivable road as points and the ways between them. Building it takes a moment, so callers keep it.
export class RoadNetwork {
  #points = new Map();
  #cells = new Map();

  constructor(roads) {
    for (const road of roads) if (isDrivable(road)) this.#addRoad(road);
  }

  #pointAt(coordinate) {
    const key = String(coordinate);
    if (!this.#points.has(key)) {
      const point = {coordinate, next: []};
      this.#points.set(key, point);
      const cell = cellKey(coordinate);
      if (!this.#cells.has(cell)) this.#cells.set(cell, []);
      this.#cells.get(cell).push(point);
    }
    return this.#points.get(key);
  }

  #addRoad({geometry, properties}) {
    const isForward = properties.oneway !== '-1';
    const isBackward = !['yes', 'true', '1'].includes(properties.oneway);
    geometry.coordinates.slice(1).forEach((coordinate, index) => {
      const start = this.#pointAt(geometry.coordinates[index]);
      const end = this.#pointAt(coordinate);
      const length = distanceMetres(start.coordinate, end.coordinate);
      if (isForward) start.next.push({point: end, length});
      if (isBackward) end.next.push({point: start, length});
    });
  }

  #pointsAround(coordinate) {
    const cells = searchedCells.flatMap(east => searchedCells.map(north => cellKey(coordinate, east, north)));
    return cells.flatMap(cell => this.#cells.get(cell) ?? []);
  }

  #nearestPoint(coordinate) {
    let nearest = null;
    for (const point of this.#pointsAround(coordinate)) {
      const distance = distanceMetres(point.coordinate, coordinate);
      if (!nearest || distance < nearest.distance) nearest = {point, distance};
    }
    return nearest && nearest.distance <= farthestRoadMetres ? nearest.point : null;
  }

  // Coordinates along the roads from one place to another, or a straight line where no way is known.
  pathBetween(from, to) {
    const start = this.#nearestPoint(from);
    const end = this.#nearestPoint(to);
    const found = start && end ? this.#shortestPath(start, end) : null;
    return found ? [from, ...found, to] : [from, to];
  }

  // A*: the straight distance to the end never overstates what is left.
  #shortestPath(start, end) {
    const reached = new Map([[start, {length: 0, previous: null}]]);
    const queue = new PriorityQueue();
    queue.push(0, start);
    while (queue.size > 0) {
      const point = queue.pop();
      if (point === end) return pathTo(end, reached);
      const {length} = reached.get(point);
      for (const {point: next, length: stepLength} of point.next) {
        const nextLength = length + stepLength;
        if (reached.has(next) && reached.get(next).length <= nextLength) continue;
        reached.set(next, {length: nextLength, previous: point});
        queue.push(nextLength + distanceMetres(next.coordinate, end.coordinate), next);
      }
    }
    return null;
  }
}

function pathTo(end, reached) {
  const path = [];
  for (let point = end; point; point = reached.get(point).previous) path.unshift(point.coordinate);
  return path;
}
