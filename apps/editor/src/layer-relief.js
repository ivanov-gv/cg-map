// Contour lines that never cross, summits higher than the lines around them, and ridges that split light from shade.
import {createElementWithText} from './dom.js';
import {crossesContours, highestContourAround, isClosedLine, keptClosed, surrounds} from './contour-rules.js';
import {roundedCoordinate} from './geometry-editing.js';
import {changedStretch, crossesItself, followingEdits} from './shared-shapes.js';

const contoursFile = 'contours.geojson';
const summitsFile = 'summits.geojson';
const ridgesFile = 'ridges.geojson';
const slopesFile = 'slopes.geojson';
const indexStepMetres = 100;
// Ridges were simplified apart from the 30 m terrain grid that the slopes follow.
const ridgeToleranceMetres = 60;
const positionTimeoutMilliseconds = 15000;
const smallestDragFraction = 1 / 256;
const crossingMessage = 'Contour lines never cross.';

// Lines need a big screen; their fields do not.
const isDesk = context => !context.isPhone();

const otherContourLines = (key, context) =>
  context
    .entriesOf(contoursFile)
    .filter(entry => entry.key !== key)
    .map(({feature}) => feature.geometry.coordinates);

// A line part of the way from where it was to where it was dragged.
function lineBetween(previousLine, line, fraction) {
  return previousLine.map((point, index) =>
    roundedCoordinate([0, 1].map(axis => point[axis] + (line[index][axis] - point[axis]) * fraction))
  );
}

// How far towards a place a line can go before it meets another: the fraction is halved until it is close enough.
function farthestAllowedLine(previousLine, line, isCrossing) {
  let allowed = previousLine;
  let fraction = 0;
  for (let stepSize = 0.5; stepSize > smallestDragFraction; stepSize /= 2) {
    const candidate = lineBetween(previousLine, line, fraction + stepSize);
    if (isCrossing(candidate)) continue;
    fraction += stepSize;
    allowed = candidate;
  }
  return allowed;
}

// A dragged point stops at the next line instead of passing it, however fast it was dragged.
function limitedContour(geometry, {key, previousGeometry}, context) {
  const previousLine = previousGeometry.coordinates;
  const line = keptClosed(geometry.coordinates, previousLine);
  const otherLines = otherContourLines(key, context);
  const isCrossing = candidate => crossesContours(candidate, previousLine, otherLines);
  if (!isCrossing(line)) return {...geometry, coordinates: line};
  return {...geometry, coordinates: farthestAllowedLine(previousLine, line, isCrossing)};
}

// Summits that a closed line would pass at or above their own height.
function summitsBelow({geometry, properties}, context) {
  if (!isClosedLine(geometry.coordinates)) return [];
  return context.entriesOf(summitsFile).filter(({feature}) => {
    const {ele} = feature.properties;
    const isBelow = Number.isFinite(ele) && ele <= properties.elevation;
    return isBelow && surrounds(geometry.coordinates, feature.geometry.coordinates);
  });
}

function contourProblem({key, feature, before}, context) {
  const isCrossing = crossesContours(
    feature.geometry.coordinates,
    before?.geometry.coordinates,
    otherContourLines(key, context)
  );
  if (isCrossing) return crossingMessage;
  const knownKeys = new Set(before ? summitsBelow(before, context).map(summit => summit.key) : []);
  const summit = summitsBelow(feature, context).find(entry => !knownKeys.has(entry.key));
  if (!summit) return null;
  const {name, ele} = summit.feature.properties;
  return `${name || 'A summit'} inside this line is ${ele} m, so the line must be lower.`;
}

const withIndexFlag = feature => ({
  ...feature,
  properties: {...feature.properties, index: feature.properties.elevation % indexStepMetres === 0}
});

function summitProblem({feature}, context) {
  const height = highestContourAround(feature.geometry.coordinates, context.entriesOf(contoursFile));
  const {ele} = feature.properties;
  if (height === null || ele === null || ele > height) return null;
  return `A summit here must be higher than ${height} m, the highest contour around it.`;
}

const hasNoHeight = ({properties}) => properties.ele === null || properties.ele === undefined;

// Phone height is only good to about 10 m, so it fills a gap and never replaces a height the map has.
function useOwnHeight(edit) {
  const onPosition = ({coords: {altitude}}) => {
    const isStillWanted = edit.isOpen() && hasNoHeight(edit.typedFeature());
    if (!isStillWanted) return;
    if (altitude === null) edit.showProblem('This device does not know its height.');
    else edit.setProperties({ele: Math.round(altitude)});
  };
  const onError = () => edit.showProblem('The height of this device is not available.');
  navigator.geolocation.getCurrentPosition(onPosition, onError, {
    enableHighAccuracy: true,
    timeout: positionTimeoutMilliseconds
  });
}

function summitTools(feature, edit) {
  if (!edit.context.isPhone() || !hasNoHeight(feature)) return [];
  return [{label: 'Use my height', run: () => useOwnHeight(edit)}];
}

function renderSummitExtras(container, {feature, context}) {
  if (!feature.geometry) return;
  const height = highestContourAround(feature.geometry.coordinates, context.entriesOf(contoursFile));
  const heightText = height === null ? 'No closed contour around it.' : `Must be higher than ${height} m, the contour around it.`;
  const note = createElementWithText('p', heightText);
  note.className = 'hint';
  container.append(note);
  if (!context.isPhone()) return;
  const phoneNote = createElementWithText('p', 'Phone height is ±10 m at best, and some phones count about 40 m higher here. Use it only where the map has none.');
  phoneNote.className = 'hint';
  container.append(phoneNote);
}

// The ends of a ridge stay inside its hill, where the two sides meet the outline.
function ridgeWithFixedEnds(geometry, {previousGeometry}) {
  const coordinates = [...geometry.coordinates];
  coordinates[0] = previousGeometry.coordinates[0];
  coordinates[coordinates.length - 1] = previousGeometry.coordinates.at(-1);
  return {...geometry, coordinates};
}

// Light and shade change on both sides at once.
function slopeEdits({feature, before}, context) {
  const stretch = changedStretch(before.geometry.coordinates, feature.geometry.coordinates);
  return stretch ? followingEdits(context.entriesOf(slopesFile), stretch, ridgeToleranceMetres) : [];
}

// Light and shade that cannot follow would no longer meet at the ridge, so that is refused.
function ridgeProblem(edit, context) {
  const {feature, before} = edit;
  if (JSON.stringify(before.geometry) === JSON.stringify(feature.geometry)) return null;
  const slopes = slopeEdits(edit, context);
  if (slopes.length === 0) return 'The slopes beside this ridge do not run along it here, so they cannot follow.';
  const isCrossing = slopes.some(({filename, key, after}) =>
    crossesItself(context.session.workingFeature(filename, key).geometry, after.geometry)
  );
  return isCrossing ? 'A slope beside this ridge would cross itself here.' : null;
}

function renderRidgeExtras(container, {feature, context}) {
  const {summit, summitName} = feature.properties;
  const entry = summit && context.findEntity(summitsFile, summit);
  const height = entry?.feature.properties.ele;
  if (summitName) container.append(createElementWithText('p', `Passes over ${summitName}${height ? ` · ${height} m` : ''}`));
  const note = createElementWithText('p', 'The ridge splits light from shade. Moving it recolours both sides at once.');
  note.className = 'hint';
  container.append(note);
}

export const reliefBehaviors = {
  [contoursFile]: {
    sections: () => [{title: 'Contour line', fields: ['elevation']}],
    prepared: withIndexFlag,
    problem: contourProblem,
    limitedGeometry: limitedContour,
    closesLines: true,
    isReshapable: isDesk
  },
  [summitsFile]: {
    title: ({properties}) => properties.name || 'Summit',
    sections: () => [{title: 'Summit', fields: ['name', 'name:en', 'ele', 'natural', 'minzoom']}],
    tools: summitTools,
    problem: summitProblem,
    renderExtras: renderSummitExtras
  },
  [ridgesFile]: {
    title: ({properties}) => properties.name || properties.summitName || 'Ridge',
    sections: () => [{title: 'Ridge', fields: ['name']}],
    isReshapable: isDesk,
    limitedGeometry: ridgeWithFixedEnds,
    problem: ridgeProblem,
    companionEdits: slopeEdits,
    renderExtras: renderRidgeExtras
  }
};
