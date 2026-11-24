// Towns, and borders that are shared: both sides of a border change at once.
import {createElementWithText} from './dom.js';
import {formatArea, geometryAreaSquareMetres} from './geometry-measures.js';
import {isInside} from './interior-point.js';
import {changedStretch, crossesItself, followingEdits} from './shared-shapes.js';

const settlementsFile = 'settlements.geojson';
const bordersFile = 'border-edges.geojson';
const municipalitiesFile = 'municipalities.geojson';
const neighboursFile = 'context-countries.geojson';
const landFile = 'land.geojson';
const squareMetresPerSquareKilometre = 1e6;
// Municipalities are built from the very points of their borders.
const municipalityToleranceMetres = 1;
// The country outline was simplified apart from the border.
const countryToleranceMetres = 60;
const seaSide = 'sea';

const polygonsOf = ({type, coordinates}) => (type === 'Polygon' ? [coordinates] : coordinates);

function municipalityAt(coordinate, context) {
  return context
    .entriesOf(municipalitiesFile)
    .find(({feature}) => polygonsOf(feature.geometry).some(rings => isInside(coordinate, rings)))?.feature;
}

// A town says which municipality it is in, wherever it is put.
function placedSettlement(feature, context, {key}) {
  const before = context.session.workingFeature(settlementsFile, key);
  const isMoved = JSON.stringify(before?.geometry) !== JSON.stringify(feature.geometry);
  const properties = {...feature.properties, place: feature.properties.place ?? feature.properties.rank};
  const municipality = municipalityAt(feature.geometry.coordinates, context)?.properties['ISO3166-2'];
  if (municipality) properties.municipality = municipality;
  // Outside of every municipality, a moved town no longer belongs to the one it came from.
  else if (isMoved) delete properties.municipality;
  return {...feature, properties};
}

function settlementProblem({feature}) {
  return feature.properties.municipality ? null : 'A town must be inside a municipality.';
}

const sidesOf = ({properties}) => [properties.left, properties.right];
export const isCoastBorder = feature => sidesOf(feature).includes(seaSide);
// Municipalities, and the inland water that belongs to none of them.
const isInsideCountry = side => side.startsWith('ME-') || side.startsWith('derived:');
const isCountryBorder = feature => !sidesOf(feature).every(isInsideCountry);

function municipalityOf(side, context) {
  return context.entriesOf(municipalitiesFile).find(({feature}) => feature.properties['ISO3166-2'] === side)?.feature;
}

const sideName = (side, context) => municipalityOf(side, context)?.properties.name ?? side;

// Where borders meet, more than two municipalities share the point, so the ends of a border stay.
function borderWithFixedEnds(geometry, {feature, previousGeometry}) {
  if (isCoastBorder(feature)) return previousGeometry;
  const coordinates = [...geometry.coordinates];
  coordinates[0] = previousGeometry.coordinates[0];
  coordinates[coordinates.length - 1] = previousGeometry.coordinates.at(-1);
  return {...geometry, coordinates};
}

// Both municipalities follow, and the country where the border is its own.
function borderFollowers({feature, before}, context) {
  const stretch = changedStretch(before.geometry.coordinates, feature.geometry.coordinates);
  if (!stretch) return [];
  const municipalities = followingEdits(context.entriesOf(municipalitiesFile), stretch, municipalityToleranceMetres);
  if (!isCountryBorder(feature)) return municipalities;
  const country = context.entriesOf(landFile).filter(entry => entry.feature.properties.kind === 'country');
  return [...municipalities, ...followingEdits(country, stretch, countryToleranceMetres)];
}

// A border whose neighbours cannot follow would leave a gap, so it is refused rather than recorded alone.
function borderProblem(edit, context) {
  const {feature, before} = edit;
  const isMoved = JSON.stringify(before.geometry) !== JSON.stringify(feature.geometry);
  if (!isMoved) return null;
  if (isCoastBorder(feature)) return 'This border is the coastline. Move it on the Water layer.';
  const followers = borderFollowers(edit, context);
  const followerCount = filename => followers.filter(entry => entry.filename === filename).length;
  const innerSideCount = sidesOf(feature).filter(isInsideCountry).length;
  const isFollowed =
    followerCount(municipalitiesFile) >= innerSideCount &&
    (!isCountryBorder(feature) || followerCount(landFile) > 0);
  if (!isFollowed) return 'The outlines beside this border do not run along it here, so they cannot follow.';
  const isCrossing = [{filename: bordersFile, key: edit.key, after: feature}, ...followers].some(({filename, key, after}) =>
    crossesItself(context.session.workingFeature(filename, key).geometry, after.geometry)
  );
  return isCrossing ? 'This border, or an outline that follows it, would cross itself here.' : null;
}

function areaText(geometry) {
  const area = geometryAreaSquareMetres(geometry);
  const isLarge = area >= squareMetresPerSquareKilometre;
  return isLarge ? `${Math.round(area / squareMetresPerSquareKilometre)} km²` : formatArea(area);
}

function renderBorderExtras(container, {feature, context}) {
  const note = isCoastBorder(feature)
    ? 'Here the border is the coastline. Move it on the Water layer.'
    : 'A border is shared. Moving it changes both sides at once, so there is never a gap or an overlap.';
  const hint = createElementWithText('p', note);
  hint.className = 'hint';
  const sides = sidesOf(feature).map(side => {
    const municipality = municipalityOf(side, context);
    const area = municipality ? ` · ${areaText(municipality.geometry)}` : '';
    return createElementWithText('p', `${sideName(side, context)}${area}`);
  });
  container.append(...sides, hint);
}

// A neighbour's name is on its outline and on the land shape behind it.
function neighbourEdits({feature}, context) {
  const {entityId, name, 'name:en': englishName} = feature.properties;
  const land = context
    .entriesOf(landFile)
    .find(entry => entry.feature.properties.kind === 'context' && entry.feature.properties.entityId === entityId);
  if (!land) return [];
  const properties = {...land.feature.properties, name};
  if (englishName !== undefined) properties['name:en'] = englishName;
  return [{filename: landFile, key: land.key, after: {...land.feature, properties}}];
}

export const settlementBehaviors = {
  [settlementsFile]: {
    kind: ({properties}) => `Settlement · ${properties.rank ?? 'new'}`,
    sections: () => [{title: 'Town', fields: ['name', 'name:en', 'rank', 'minzoom']}],
    prepared: placedSettlement,
    problem: settlementProblem
  },
  [bordersFile]: {
    kind: feature => (isCountryBorder(feature) ? 'Border · country' : 'Border · municipality'),
    title: (feature, context) => sidesOf(feature).map(side => sideName(side, context)).join(' | '),
    sections: () => [],
    limitedGeometry: borderWithFixedEnds,
    problem: borderProblem,
    companionEdits: borderFollowers,
    renderExtras: renderBorderExtras
  },
  [neighboursFile]: {
    sections: () => [{title: 'Neighbour country', fields: ['name', 'name:en']}],
    companionEdits: neighbourEdits
  }
};
