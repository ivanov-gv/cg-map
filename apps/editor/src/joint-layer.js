// Dots where lines join, end or only touch, and the letters at the ends of the picked road. A dot can be picked.
import {hitTest} from '@ivanov-gv/map-core';
import {stateColors} from './object-states.js';

const jointSource = 'editor-joints';
const markSource = 'editor-marks';
const dotLayerId = 'editor-joints-dot';
// Closer in, roads stand far enough apart for their dots.
export const jointMinZoom = 16;
const hitRadiusPixels = 10;
const dotRadiusPixels = 4.5;
const warningRadiusPixels = 8;

const warningStatuses = ['apart', 'near', 'crossing'];
const isWarning = ['in', ['get', 'status'], ['literal', warningStatuses]];
const featureCollection = features => ({type: 'FeatureCollection', features});
const pointFeature = (coordinate, properties) => ({
  type: 'Feature',
  properties,
  geometry: {type: 'Point', coordinates: coordinate}
});

const symbolLayer = (id, source, textField, filter, color) => ({
  id,
  type: 'symbol',
  source,
  ...(filter ? {filter} : {}),
  layout: {
    'text-field': textField,
    'text-font': ['Open Sans Semibold'],
    'text-size': 13,
    'text-allow-overlap': true,
    'text-ignore-placement': true
  },
  paint: {'text-color': color}
});

const dotLayer = {
  id: dotLayerId,
  type: 'circle',
  source: jointSource,
  minzoom: jointMinZoom,
  paint: {
    'circle-radius': ['case', isWarning, warningRadiusPixels, dotRadiusPixels],
    // A dead end is hollow, a join is full.
    'circle-color': ['case', isWarning, stateColors.applied, ['in', ['get', 'status'], ['literal', ['deadEnd', 'cutOff']]], '#ffffff', stateColors.editable],
    'circle-stroke-color': ['case', isWarning, '#ffffff', ['in', ['get', 'status'], ['literal', ['deadEnd', 'cutOff']]], stateColors.editable, '#ffffff'],
    'circle-stroke-width': 1.5
  }
};

const markDot = {
  id: 'editor-marks-dot',
  type: 'circle',
  source: markSource,
  paint: {
    'circle-radius': 10,
    'circle-color': '#ffffff',
    'circle-stroke-color': stateColors.highlighted,
    'circle-stroke-width': 2
  }
};

export function createJointLayer(map) {
  for (const source of [jointSource, markSource]) {
    map.addSource(source, {type: 'geojson', data: featureCollection([])});
  }
  map.addLayer(dotLayer);
  map.addLayer({...symbolLayer('editor-joints-warning', jointSource, '!', isWarning, '#ffffff'), minzoom: jointMinZoom});
  map.addLayer(markDot);
  map.addLayer(symbolLayer('editor-marks-letter', markSource, ['get', 'label'], null, stateColors.highlighted));
  let joints = [];
  return {
    show(shownJoints) {
      joints = shownJoints;
      const features = joints.map(({coordinate, status}, index) => pointFeature(coordinate, {status, index}));
      map.getSource(jointSource).setData(featureCollection(features));
    },
    showMarks(marks) {
      map.getSource(markSource).setData(featureCollection(marks.map(({coordinate, label}) => pointFeature(coordinate, {label}))));
    },
    // The joint under a tap with its exact place, or null. A warning is picked before what it lies on.
    jointAt(point) {
      const hits = hitTest(map, point, [dotLayerId], hitRadiusPixels).map(({properties}) => joints[properties.index]);
      const found = hits.filter(Boolean);
      return found.find(({status}) => warningStatuses.includes(status)) ?? found[0] ?? null;
    }
  };
}
