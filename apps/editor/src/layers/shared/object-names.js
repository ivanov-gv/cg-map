// What an object is called in the inspector, the lists and the messages. Layers name their own objects better where
// they can; this is the fallback every object has.
const kindLabels = {
  'buildings.geojson': 'Building',
  'building-entrances.geojson': 'Entrance',
  'building-labels.geojson': 'Address',
  'places.geojson': 'Place',
  'roads.geojson': 'Road',
  'road-nodes.geojson': 'Junction',
  'bridges.geojson': 'Bridge',
  'railways.geojson': 'Railway',
  'land.geojson': 'Green area',
  'protected-areas.geojson': 'Protected area',
  'water.geojson': 'Water',
  'contours.geojson': 'Contour line',
  'summits.geojson': 'Summit',
  'ridges.geojson': 'Ridge',
  'slopes.geojson': 'Slope',
  'canyon-rims.geojson': 'Canyon edge',
  'settlements.geojson': 'Settlement',
  'settlement-areas.geojson': 'Settlement area',
  'border-edges.geojson': 'Border',
  'municipalities.geojson': 'Municipality',
  'context-countries.geojson': 'Neighbour country',
  'transport-stops.geojson': 'Bus stop',
  'transit-routes.json': 'Route',
  'turn-restrictions.json': 'Turn'
};

export const kindLabel = filename => kindLabels[filename] ?? filename;

// How other objects name a building: one added here by its local ID.
export const buildingId = ({key, feature}) => feature.properties.entityId ?? key;

// "Njegoševa 14" where an object has an address.
export function addressText(properties) {
  return [properties['addr:street'], properties['addr:housenumber']].filter(Boolean).join(' ');
}

const nameByFile = {
  'contours.geojson': ({elevation}) => `${elevation} m`,
  'border-edges.geojson': ({left, right}) => `${left} | ${right}`,
  'transit-routes.json': ({number, name}) => (number ? `Line ${number}` : name),
  'building-entrances.geojson': properties => `Entrance ${properties.ref ?? addressText(properties)}`.trim(),
  'road-nodes.geojson': ({kind}) => kind.replaceAll('_', ' '),
  'turn-restrictions.json': ({restriction}) => restriction.replaceAll('_', ' ')
};

// The inspector and object list share one display name; geometry and revision keys belong in list context only.
export function objectName(feature, filename = null) {
  const {properties} = feature;
  const ownName = filename ? nameByFile[filename]?.(properties) : null;
  return ownName || properties.name || addressText(properties) || 'Unnamed';
}

// Geometry and the revision-bound key distinguish unnamed objects and names shared by several sources.
export function objectLabel({filename, key, feature}) {
  const geometryType = feature.geometry?.type ?? 'Record';
  return `${objectName(feature, filename)} · ${geometryType} · feature ${key}`;
}
