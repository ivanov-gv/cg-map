// Contour lines that never cross, summits higher than the lines around them, and ridges that split light from shade.
import {createElementWithText} from '../../shared/dom.js';
import {crossesContours, highestContourAround, isClosedLine, keptClosed, surrounds} from './contour-rules.js';
import {roundedCoordinate} from '../../geometry/geometry-editing.js';
import {distanceMetres, nearestPointOnSegment} from '../../geometry/geometry-measures.js';
import {greenKinds} from '../../source-data/derived-facts.js';
import {isSamePoint} from '../roads/road-shapes.js';
import {hasMovedEnds, isEndRemoved, sidesOfRidge, slidEnd, slopesWithSlidEnds} from './ridge-ends.js';
import {endTargetsOf, validateRidgeTopology} from './ridge-topology.js';
import {slopeFaceFeatures} from './slope-faces.js';
import {changedStretch, crossesItself, followingEdits} from '../../geometry/shared-shapes.js';

const contoursFile = 'contours.geojson';
const summitsFile = 'summits.geojson';
const landFile = 'land.geojson';
const ridgesFile = 'ridges.geojson';
const slopesFile = 'slopes.geojson';
const indexStepMetres = 100;
// Ridges were simplified apart from the 30 m terrain grid that the slopes follow.
const ridgeToleranceMetres = 60;
const positionTimeoutMilliseconds = 15000;
const slopesOfRidge = 2;
const smallestDragFraction = 1 / 256;
// A tap near a green outline or another ridge joins it; farther taps stay where they were put.
const ridgeSnapToleranceMetres = 12;
const crossingMessage = 'Contour lines never cross.';
const removedEndMessage = 'A ridge end cannot be removed. Move it along the outline of its hill instead.';

// Lines need a big screen; their fields do not.
const isDesk = context => !context.isPhone();
// A version 3 bundle stores its slopes, so a ridge recolours them there; version 4 derives them instead.
const hasSlopes = context => !context.hasFile || context.hasFile(slopesFile);

const collectionOf = features => ({type: 'FeatureCollection', features});
const featureValues = entries => entries.map(({feature}) => feature);

// Why this set of ridges cannot be released, or null when it can. The source check's own detail is reused in the
// inspector, so a feature ID with a colon in it cannot leave a raw prefix in the message.
function topologyProblemOf(ridges, context) {
  const land = collectionOf(featureValues(context.entriesOf(landFile)));
  try {
    validateRidgeTopology(land, ridges, greenKinds);
    return null;
  } catch (error) {
    return {label: error.label, detail: error.detail ?? error.message};
  }
}

// The candidate replaces the open ridge, so one bad ridge cannot be hidden by the old copy of it.
function ridgeFeaturesFor(change, context) {
  const others = context.entriesOf(ridgesFile).filter(entry => entry.key !== change.key);
  return collectionOf([...featureValues(others), change.feature]);
}

function topologyProblem(change, context) {
  const problem = topologyProblemOf(ridgeFeaturesFor(change, context), context);
  return problem ? `Ridge: ${problem.detail}` : null;
}

// A version 4 ridge may end on another ridge, so deleting that other ridge can leave an end loose.
function deletionProblem(entry, context) {
  if (hasSlopes(context)) return null;
  const remaining = context.entriesOf(ridgesFile).filter(other => other.key !== entry.key);
  const problem = topologyProblemOf(collectionOf(featureValues(remaining)), context);
  return problem ? `Deleting this ridge would leave ${problem.label}: ${problem.detail}.` : null;
}

function nearestTarget(coordinate, segments) {
  return segments
    .map(segment => nearestPointOnSegment(coordinate, ...segment))
    .reduce((nearest, candidate) =>
      distanceMetres(candidate, coordinate) < distanceMetres(nearest, coordinate) ? candidate : nearest);
}

// A new ridge's points join the outline of its green area or another ridge when they are tapped close to one.
function snappedRidgePoint({lngLat}, context, feature) {
  if (hasSlopes(context)) return null;
  const coordinate = lngLat.toArray();
  const drawn = feature.geometry?.coordinates ?? [];
  const candidate = drawn.length > 0 ? [...drawn, coordinate] : [coordinate, coordinate];
  const land = collectionOf(featureValues(context.entriesOf(landFile)));
  const ridges = collectionOf(featureValues(context.entriesOf(ridgesFile)));
  const targets = endTargetsOf(candidate, land, ridges, greenKinds);
  if (targets.length === 0) return null;
  const nearest = nearestTarget(coordinate, targets);
  return distanceMetres(nearest, coordinate) <= ridgeSnapToleranceMetres ? roundedCoordinate(nearest) : null;
}

// Version 4 has no slopes to follow: each end slides to the nearest outline of its green area or another ridge.
function ridgeWithValidEnds(geometry, change, context) {
  const before = change.before?.geometry?.coordinates ?? change.previousGeometry?.coordinates;
  if (!before) return geometry;
  const otherRidges = collectionOf(
    featureValues(context.entriesOf(ridgesFile).filter(entry => entry.key !== change.key))
  );
  const land = collectionOf(featureValues(context.entriesOf(landFile)));
  const targets = endTargetsOf(before, land, otherRidges, greenKinds);
  if (targets.length === 0) return geometry;
  const coordinates = [...geometry.coordinates];
  for (const index of [0, coordinates.length - 1]) {
    if (isSamePoint(coordinates[index], before.at(index === 0 ? 0 : -1))) continue;
    coordinates[index] = roundedCoordinate(nearestTarget(coordinates[index], targets));
  }
  return {...geometry, coordinates};
}

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
    if (altitude === null) edit.showMessage('This device does not know its height.');
    else edit.setProperties({ele: Math.round(altitude)});
  };
  const onError = () => edit.showMessage('The height of this device is not available.');
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
  const warning = 'Phone height is ±10 m at best, and some phones count about 40 m higher here.';
  const phoneNote = createElementWithText('p', `${warning} Use it only where the map has none.`);
  phoneNote.className = 'hint';
  container.append(phoneNote);
}

// The ends of a ridge lie on the outline of its hill and slide along it. Where its sides cannot be told they stay.
function ridgeWithEndsOnOutline(geometry, {key, previousGeometry}, context) {
  if (!hasSlopes(context)) return geometry;
  const before = context.session.workingFeature(ridgesFile, key);
  const sides = sidesOfRidge(before.geometry.coordinates, context.entriesOf(slopesFile), ridgeToleranceMetres);
  const previous = previousGeometry.coordinates;
  const coordinates = [...geometry.coordinates];
  for (const [index, otherIndex] of [[0, -1], [coordinates.length - 1, 0]]) {
    const isMoved = !isSamePoint(coordinates[index], previous.at(index === 0 ? 0 : -1));
    if (!isMoved) continue;
    const slid = sides ? slidEnd(coordinates[index], previous.at(otherIndex), sides) : null;
    coordinates[index] = slid ?? previous.at(index === 0 ? 0 : -1);
  }
  return {...geometry, coordinates};
}

// Light and shade change on both sides at once.
function slopeEdits({feature, before}, context) {
  if (!hasSlopes(context)) return [];
  if (hasMovedEnds(before.geometry.coordinates, feature.geometry.coordinates)) {
    const sides = sidesOfRidge(before.geometry.coordinates, context.entriesOf(slopesFile), ridgeToleranceMetres);
    return sides ? slopesWithSlidEnds(feature.geometry.coordinates, sides) : [];
  }
  const stretch = changedStretch(before.geometry.coordinates, feature.geometry.coordinates);
  return stretch ? followingEdits(context.entriesOf(slopesFile), stretch, ridgeToleranceMetres) : [];
}

// An edit must respect the slope shapes it would move, or the version-4 ridge rules on a bundle without slopes.
function ridgeProblem(edit, context) {
  const {feature, before, origins} = edit;
  if (before?.geometry && JSON.stringify(before.geometry) === JSON.stringify(feature.geometry)) return null;
  if (before?.geometry && isEndRemoved(before.geometry.coordinates, feature.geometry.coordinates, origins)) {
    return removedEndMessage;
  }
  if (!hasSlopes(context)) return topologyProblem(edit, context);
  const slopes = slopeEdits(edit, context);
  // One is sunlit and one is shaded.
  if (slopes.length < slopesOfRidge) return 'The slopes beside this ridge do not run along it here, so they cannot follow.';
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
  const explanation = context.hasFile && !context.hasFile(slopesFile)
    ? 'Each end lies on the green area outline or another ridge, and the two slope faces are drawn from the ridge.'
    : 'The ridge splits light from shade. Moving it recolours both sides at once, and its ends slide along the outline of the hill.';
  const note = createElementWithText('p', explanation);
  note.className = 'hint';
  container.append(note);
}

// Version 4 has no published slopes. Its faces are drawn from the working ridges and green areas, as a preview: they
// are never picked, session edits or changeset operations.
function ridgePreviewFeatures(context) {
  if (hasSlopes(context)) return {};
  const land = featureValues(context.entriesOf(landFile));
  const ridges = context.entriesOf(ridgesFile).map(({feature}) => feature.geometry);
  return {[slopesFile]: slopeFaceFeatures(land, ridges)};
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
    snappedPoint: snappedRidgePoint,
    limitedGeometry: (geometry, change, context) => hasSlopes(context)
      ? ridgeWithEndsOnOutline(geometry, change, context)
      : ridgeWithValidEnds(geometry, change, context),
    problem: ridgeProblem,
    companionEdits: slopeEdits,
    derivedPreviews: ridgePreviewFeatures,
    deletion: (entry, context) => {
      const problem = deletionProblem(entry, context);
      return problem ? {problem} : {message: '', edits: []};
    },
    renderExtras: renderRidgeExtras
  }
};
