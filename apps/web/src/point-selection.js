const MAX_ENTRANCES_PER_BUILDING = 100;
const MAX_ADDRESS_TEXT_LENGTH = 128;
const ENTRANCE_LABEL_ZOOM = 18;
const SELECTED_ENTRANCE_MIN_ZOOM = 13;
const ENTRANCE_LAYERS = [
  'entrance-points',
  'entrance-numbers',
  'entrance-selection-numbers',
  'entrance-selection-arrows',
];

// Number placeholders describe missing information and must never become map labels.
function isMissingNumber(value) {
  const normalized = value.toLowerCase().replace(/[\s./_-]/g, '');
  return ['', 'bb', 'бб', 'bezbroja', 'безброја', 'na', '?'].includes(
    normalized,
  );
}

function isAddressText(value) {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= MAX_ADDRESS_TEXT_LENGTH
  );
}

// Reject malformed entrance metadata before giving coordinates or labels to MapLibre.
export function validateBuildingAddress(properties) {
  const hasLegacyNumber = properties['addr:housenumber'] !== undefined;
  const hasBuildingNumber = properties.building_number !== undefined;
  const hasEntrances =
    Array.isArray(properties.entrances) && properties.entrances.length > 0;
  if (!hasLegacyNumber && !hasBuildingNumber && !hasEntrances)
    throw new Error('Missing building address or entrances');

  for (const field of [
    'addr:housenumber',
    'building_number',
    'lamela',
    'addr:street',
  ]) {
    const value = properties[field];
    if (value === undefined) continue;
    const isNumber = ['addr:housenumber', 'building_number'].includes(field);
    if (!isAddressText(value) || (isNumber && isMissingNumber(value)))
      throw new Error(`Invalid building ${field}`);
  }
  if (properties.entrances === undefined) return;
  if (
    !Array.isArray(properties.entrances) ||
    properties.entrances.length > MAX_ENTRANCES_PER_BUILDING
  )
    throw new Error('Invalid building entrances');
  const entranceIDs = new Set();
  for (const entrance of properties.entrances) {
    const hasUniqueIdentity =
      entrance &&
      /^node\/\d+$/.test(entrance.id) &&
      !entranceIDs.has(entrance.id);
    if (!hasUniqueIdentity) throw new Error('Invalid or duplicate entrance ID');
    entranceIDs.add(entrance.id);
    const coordinates = entrance.coordinates;
    const isPosition =
      Array.isArray(coordinates) &&
      coordinates.length === 2 &&
      coordinates.every(Number.isFinite);
    if (
      !isPosition ||
      Math.abs(coordinates[0]) > 180 ||
      Math.abs(coordinates[1]) > 90
    )
      throw new Error('Invalid entrance coordinates');
    const hasBearing = Number.isFinite(entrance.bearing) && entrance.bearing >= 0 && entrance.bearing < 360;
    if (!hasBearing) throw new Error('Invalid entrance bearing');
    for (const field of ['number', 'ref', 'lamela', 'street']) {
      const value = entrance[field];
      if (value === undefined) continue;
      if (
        !isAddressText(value) ||
        (field === 'number' && isMissingNumber(value))
      )
        throw new Error(`Invalid entrance ${field}`);
    }
  }
}

// Keep the house number, entrance reference and building section distinct.
export function entranceLabel(entrance) {
  return (
    [
      entrance.number,
      entrance.ref ? `Ulaz ${entrance.ref}` : '',
      entrance.lamela ? `Lamela ${entrance.lamela}` : '',
    ]
      .filter(Boolean)
      .join(', ') || 'Entrance'
  );
}

// Numeric bounds summarize recorded numbers; lettered identifiers remain an explicit list.
function entranceNumberRange(entrances) {
  const uniqueNumbers = new Set(
    entrances.map((entrance) => entrance.number).filter(Boolean),
  );
  const numbers = [...uniqueNumbers].sort((first, second) =>
    first.localeCompare(second, 'sr-Latn', { numeric: true }),
  );
  if (numbers.length < 2) return numbers[0] ?? '';
  const areNumeric = numbers.every((number) => /^\d+$/.test(number));
  return areNumeric ? `${numbers[0]}-${numbers.at(-1)}` : numbers.join(', ');
}

// Legacy labels have unknown address granularity; additional section metadata must preserve their number.
export function buildingNumber(properties) {
  const isLegacyAddress =
    properties.entrances === undefined &&
    properties.building_number === undefined;
  const section = properties.lamela ? `Lamela ${properties.lamela}` : '';
  if (isLegacyAddress)
    return [properties['addr:housenumber'], section].filter(Boolean).join(', ');

  const streetEntrances = new Map();
  for (const entrance of properties.entrances ?? []) {
    const street = entrance.street ?? properties['addr:street'] ?? '';
    if (!streetEntrances.has(street)) streetEntrances.set(street, []);
    streetEntrances.get(street).push(entrance);
  }
  const hasMultipleStreets = streetEntrances.size > 1;
  const entranceNumbers = [...streetEntrances]
    .map(([street, entrances]) => {
      return [hasMultipleStreets ? street : '', entranceNumberRange(entrances)]
        .filter(Boolean)
        .join(' ');
    })
    .filter(Boolean)
    .join('; ');
  const building = properties.building_number
    ? `Zgrada ${properties.building_number}`
    : '';
  return [building, section, entranceNumbers].filter(Boolean).join(', ');
}

// An explicit entrance street takes precedence for that entrance, without crossing street-number associations.
export function buildingAddress(properties) {
  const streets = [
    ...new Set(
      (properties.entrances ?? []).map(
        (entrance) => entrance.street ?? properties['addr:street'] ?? '',
      ),
    ),
  ];
  const number = buildingNumber(properties);
  const street =
    streets.length > 1 ? '' : (streets[0] ?? properties['addr:street'] ?? '');
  const hasSeparateBuilding = properties.building_number !== undefined;
  const hasSeparateSection =
    properties.lamela !== undefined && properties.entrances !== undefined;
  return [street, number]
    .filter(Boolean)
    .join(hasSeparateBuilding || hasSeparateSection ? ', ' : ' ');
}

// Index only this reviewed snapshot; footprint indices are not stable OSM identities.
export function buildingAddressIndex(labels) {
  if (labels?.type !== 'FeatureCollection' || !Array.isArray(labels.features))
    throw new Error('Invalid building address collection');
  const addresses = new Map();
  const entranceIDs = new Set();
  for (const feature of labels.features) {
    const properties = feature.properties;
    const hasUniqueFootprint =
      properties &&
      Number.isInteger(properties.footprintIndex) &&
      properties.footprintIndex >= 0 &&
      !addresses.has(properties.footprintIndex);
    if (!hasUniqueFootprint)
      throw new Error('Invalid building footprint reference');
    validateBuildingAddress(properties);
    for (const entrance of properties.entrances ?? []) {
      if (entranceIDs.has(entrance.id))
        throw new Error('Entrance belongs to multiple buildings');
      entranceIDs.add(entrance.id);
    }
    addresses.set(properties.footprintIndex, properties);
  }
  return addresses;
}

// Derive display text without changing reviewed source attributes or geometry.
export function buildingMapFeatures(labels) {
  const features = labels.features.map((feature) => ({
    ...feature,
    properties: {
      ...feature.properties,
      display_number: buildingNumber(feature.properties),
    },
  }));
  return { ...labels, features };
}

// Entrance positions remain separate points linked to the revision-bound footprint.
export function entranceFeatures(labels) {
  const features = labels.features.flatMap((feature) =>
    (feature.properties.entrances ?? []).map((entrance) => ({
      type: 'Feature',
      id: entrance.id,
      geometry: { type: 'Point', coordinates: [...entrance.coordinates] },
      properties: {
        ...entrance,
        footprintIndex: feature.properties.footprintIndex,
        label: entranceLabel(entrance),
      },
    })),
  );
  return { type: 'FeatureCollection', features };
}

// The local font subset has no arrow glyph. This small icon's tip meets the entrance dot.
function entranceArrowImage() {
  const pixelRatio = 2;
  const canvas = document.createElement('canvas');
  canvas.width = 18 * pixelRatio;
  canvas.height = 20 * pixelRatio;
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error(
      'Canvas 2D is unavailable; entrance arrows cannot be drawn.',
    );
  context.scale(pixelRatio, pixelRatio);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(9, 2);
  context.lineTo(9, 17);
  context.moveTo(4, 12);
  context.lineTo(9, 17);
  context.lineTo(14, 12);
  context.strokeStyle = '#fffef8';
  context.lineWidth = 5;
  context.stroke();
  context.strokeStyle = '#c43f3f';
  context.lineWidth = 2.5;
  context.stroke();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

// Install local entrance symbols; selection has collision-free labels at building-selection zooms.
export function installEntranceLayers(map) {
  map.addImage('entrance-arrow', entranceArrowImage(), { pixelRatio: 2 });
  map.addSource('building-entrances', {
    type: 'geojson',
    promoteId: 'id',
    data: { type: 'FeatureCollection', features: [] },
  });
  map.addLayer({
    id: 'entrance-points',
    type: 'circle',
    source: 'building-entrances',
    minzoom: ENTRANCE_LABEL_ZOOM,
    paint: {
      'circle-radius': 3,
      'circle-color': '#514d44',
      'circle-stroke-color': '#fffef8',
      'circle-stroke-width': 1.5,
    },
  });
  const labels = {
    type: 'symbol',
    source: 'building-entrances',
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Open Sans Semibold'],
      'text-size': 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.4],
      'text-padding': 2,
    },
    paint: {
      'text-color': '#514d44',
      'text-halo-color': '#fffef8',
      'text-halo-width': 1.5,
    },
  };
  const noSelection = ['==', ['get', 'footprintIndex'], -1];
  map.addLayer({
    ...labels,
    id: 'entrance-numbers',
    minzoom: ENTRANCE_LABEL_ZOOM,
  });
  map.addLayer({
    ...labels,
    id: 'entrance-selection-numbers',
    minzoom: SELECTED_ENTRANCE_MIN_ZOOM,
    filter: noSelection,
    layout: {
      ...labels.layout,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
  });
  map.addLayer({
    id: 'entrance-selection-arrows',
    type: 'symbol',
    source: 'building-entrances',
    minzoom: SELECTED_ENTRANCE_MIN_ZOOM,
    filter: noSelection,
    layout: {
      'icon-image': 'entrance-arrow',
      'icon-anchor': 'bottom',
      // The icon points south before rotation; bearings point inward from the entrance's nearest wall.
      'icon-rotate': ['-', ['get', 'bearing'], 180],
      'icon-rotation-alignment': 'map',
      'icon-pitch-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  });
}

// Clear arrows with the selection, and avoid drawing the selected entrance labels twice.
export function selectBuildingEntrances(map, footprintIndex) {
  const selectedFootprint = footprintIndex ?? -1;
  for (const layer of [
    'entrance-selection-numbers',
    'entrance-selection-arrows',
  ]) {
    map.setFilter(layer, ['==', ['get', 'footprintIndex'], selectedFootprint]);
  }
  map.setFilter('entrance-numbers', [
    '!=',
    ['get', 'footprintIndex'],
    selectedFootprint,
  ]);
}

// Layer identity supplies a truthful fallback when a feature has no recorded name.
function pointKind(layer, properties) {
  if (layer === 'transport-stops') return 'Bus stop';
  if (ENTRANCE_LAYERS.includes(layer)) return 'Entrance';
  if (['buildings', 'building-numbers'].includes(layer)) return 'Building';
  if (layer === 'land') return properties.kind === 'park' ? 'Park' : 'Land';
  if (['water', 'rivers'].includes(layer)) return 'Water';
  if (!layer) return 'Map point';
  return properties.bridge && properties.bridge !== 'no' ? 'Bridge' : 'Road';
}

// Point descriptions use published attributes and retain original entrance coordinates rather than tile quantization.
export function describePoint(
  feature,
  coordinates,
  buildingAddresses = new Map(),
) {
  const original = feature?.properties ?? {};
  const layer = feature?.layer?.id;
  const isEntrance = ENTRANCE_LAYERS.includes(layer);
  const isBuildingLabel = layer === 'building-numbers';
  const footprintIndex =
    layer === 'buildings' ? feature.id : original.footprintIndex;
  const address =
    layer === 'buildings' || isBuildingLabel || isEntrance
      ? buildingAddresses.get(footprintIndex)
      : null;
  const properties = isEntrance ? (address ?? {}) : { ...original, ...address };
  const kind = pointKind(layer, properties);
  const number = buildingNumber(properties);
  const entrance = isEntrance
    ? (address?.entrances.find((entrance) => entrance.id === original.id) ??
      original)
    : null;
  const hasName =
    typeof properties.name === 'string' && properties.name.trim().length > 0;
  const name = isEntrance
    ? entranceLabel(entrance)
    : hasName
      ? properties.name
      : kind === 'Building' && number
        ? `Building ${number}`
        : kind;
  const pointCoordinates = isEntrance
    ? entrance.coordinates
    : kind === 'Bus stop'
      ? feature.geometry.coordinates
      : coordinates;
  if (kind === 'Bus stop')
    return {
      coordinates: [...pointCoordinates],
      name,
      kind,
      details: [
        `Stop ID: ${properties.stopId}`,
        'Source: ePodgorica · snapshot 18 October 2026',
      ],
    };
  const addressLine = entrance
    ? buildingAddress({
        ...properties,
        'addr:street': entrance.street ?? properties['addr:street'],
        entrances: [entrance],
      })
    : buildingAddress(properties);
  const entranceDetails =
    kind === 'Building'
      ? (properties.entrances ?? []).map(
          (entrance) => `Entrance: ${entranceLabel(entrance)}`,
        )
      : [];
  return {
    coordinates: [...pointCoordinates],
    name,
    kind,
    details: layer
      ? [
          properties.kind
            ? `Type: ${properties.kind.replaceAll('_', ' ')}`
            : '',
          addressLine,
          ...entranceDetails,
          'Source: OpenStreetMap · available map attributes only',
        ]
      : [],
  };
}

export function endpointFeatures(endpoints) {
  return {type: 'FeatureCollection', features: ['from', 'to'].filter(role => endpoints[role]).map(role => ({
    type: 'Feature', geometry: {type: 'Point', coordinates: [...endpoints[role].coordinates]},
    properties: {role, label: role === 'from' ? 'A' : 'B', name: endpoints[role].name}
  }))};
}

export function installRoutePoints(map) {
  map.addSource('route-points', {type: 'geojson', data: endpointFeatures({})});
  map.addLayer({id: 'route-point-circles', type: 'circle', source: 'route-points', paint: {
    'circle-radius': 15, 'circle-color': ['match', ['get', 'role'], 'from', '#193f36', '#a34c35'],
    'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3
  }});
  map.addLayer({id: 'route-point-labels', type: 'symbol', source: 'route-points', layout: {
    'text-field': ['get', 'label'], 'text-font': ['Open Sans Semibold'], 'text-size': 12,
    'text-allow-overlap': true, 'text-ignore-placement': true
  }, paint: {'text-color': '#ffffff'}});
}
