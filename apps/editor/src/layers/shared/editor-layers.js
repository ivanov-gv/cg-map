// The layers someone chooses from, as the wiki's Editor page lists them. A layer can span several source files: what
// belongs together on the map is edited together. `files` hold the objects that can be picked; `linkedFiles` change
// only with them, such as the municipalities on both sides of a border.
export const editorLayers = [
  {
    id: 'buildings',
    group: 'Map',
    name: 'Buildings',
    summary: 'Shape, levels, material, entrances',
    files: ['buildings.geojson', 'building-entrances.geojson'],
    linkedFiles: ['building-labels.geojson', 'places.geojson']
  },
  {
    id: 'addresses',
    group: 'Map',
    name: 'Addresses',
    summary: 'House numbers and their streets',
    files: ['building-labels.geojson'],
    linkedFiles: ['buildings.geojson']
  },
  {
    id: 'places',
    group: 'Map',
    name: 'Places & points',
    summary: 'Shops, cafés, monuments, gates',
    files: ['places.geojson'],
    linkedFiles: []
  },
  {
    id: 'roads',
    group: 'Map',
    name: 'Roads & paths',
    summary: 'Streets, paths, levels, directions, bridge decks',
    files: ['roads.geojson', 'road-nodes.geojson', 'bridges.geojson'],
    linkedFiles: ['turn-restrictions.json']
  },
  {
    id: 'green',
    group: 'Map',
    name: 'Parks & green',
    summary: 'Parks, meadows, gardens, woods',
    files: ['land.geojson', 'protected-areas.geojson'],
    linkedFiles: []
  },
  {
    id: 'water',
    group: 'Map',
    name: 'Water',
    summary: 'Lakes, rivers, the coastline',
    files: ['water.geojson'],
    linkedFiles: ['land.geojson', 'border-edges.geojson', 'municipalities.geojson']
  },
  {
    id: 'relief',
    group: 'Map',
    name: 'Relief',
    summary: 'Contour lines and summits',
    files: ['contours.geojson', 'summits.geojson', 'ridges.geojson', 'canyon-rims.geojson'],
    linkedFiles: ['slopes.geojson'],
    // Light and shade, so that moving a ridge shows at once. They follow from the ridges and are never picked.
    contextFiles: ['slopes.geojson'],
    guideMinZoom: 13
  },
  {
    id: 'settlements',
    group: 'Map',
    name: 'Settlements & borders',
    summary: 'Towns and their areas, municipalities, country',
    files: ['settlements.geojson', 'settlement-areas.geojson', 'border-edges.geojson', 'context-countries.geojson'],
    linkedFiles: ['municipalities.geojson', 'land.geojson'],
    // Borders need a big screen.
    phoneFiles: ['settlements.geojson'],
    guideMinZoom: 7,
    // The country's towns seen together would cover its borders with rings.
    pointGuideMinZoom: 11
  },
  {
    id: 'stops',
    group: 'Transport',
    name: 'Stops',
    summary: 'Bus stops and the lines they serve',
    files: ['transport-stops.geojson'],
    linkedFiles: ['transit-routes.json'],
    guideMinZoom: 13
  },
  {
    id: 'routes',
    group: 'Transport',
    name: 'Routes',
    summary: 'Lines as stop sequences, both ways',
    files: ['transit-routes.json'],
    linkedFiles: ['transport-stops.geojson'],
    // Shown to pick stops from, and edited on their own layer.
    contextFiles: ['transport-stops.geojson'],
    guideMinZoom: 13
  },
  {
    id: 'railways',
    group: 'Transport',
    name: 'Railways',
    summary: 'Tracks, platforms, stations',
    files: ['railways.geojson'],
    linkedFiles: [],
    guideMinZoom: 13
  }
];

// Kinds that only follow from other objects, or only frame the map, are not objects of any layer.
const derivedKinds = {
  'land.geojson': ['country', 'context'],
  'water.geojson': ['ocean']
};

export const isLayerObject = (filename, feature) => !derivedKinds[filename]?.includes(feature.properties.kind);

// Version 5 stores the whole surface in one file. Each layer shows only the kinds it edits, so a green area and a
// municipality never appear as pickable objects on the same screen.
export const surfaceLayerKinds = {
  green: [
    'park', 'garden', 'woods', 'meadow', 'grass', 'scrub', 'sports', 'cemetery', 'playground', 'shade', 'protected-area'
  ],
  water: ['lake', 'river', 'reservoir', 'pond', 'basin', 'water', 'stream', 'canal', 'ditch', 'drain'],
  settlements: ['municipality', 'context', 'sea']
};

// What changes in the layer registry when the reviewed bundle follows the version 5 model. Files absent from the bundle
// are still filtered out below, so a partial fixture cannot open an empty layer.
const version5LayerOverrides = {
  addresses: null,
  buildings: {files: ['buildings.geojson'], linkedFiles: []},
  places: {},
  roads: {files: ['roads.geojson', 'bridges.geojson'], linkedFiles: []},
  green: {
    files: ['surface.geojson'],
    linkedFiles: [],
    kindsByFile: {'surface.geojson': surfaceLayerKinds.green}
  },
  water: {
    files: ['surface.geojson'],
    linkedFiles: [],
    kindsByFile: {'surface.geojson': surfaceLayerKinds.water}
  },
  relief: {files: ['relief.geojson', 'canyon-rims.geojson'], linkedFiles: [], contextFiles: []},
  settlements: {
    files: ['settlements.geojson', 'surface.geojson'],
    linkedFiles: [],
    phoneFiles: ['settlements.geojson'],
    kindsByFile: {'surface.geojson': surfaceLayerKinds.settlements}
  },
  stops: {linkedFiles: []},
  routes: {files: ['transit-routes.json'], linkedFiles: [], contextFiles: []},
  railways: {}
};

// A reviewed bundle from an earlier version has fewer files. A layer keeps those it has, and one without any is left out.
export function availableLayers(filenames, bundleVersion = 3) {
  const isAvailable = filename => filenames.includes(filename);
  const layers = bundleVersion >= 5 ? editorLayers.map(layer => ({...layer, ...version5LayerOverrides[layer.id]})) : editorLayers;
  return layers
    .filter(layer => layer !== null)
    .map(layer => {
      const phoneFiles = (layer.phoneFiles ?? []).filter(isAvailable);
      return {
        ...layer,
        files: layer.files.filter(isAvailable),
        linkedFiles: layer.linkedFiles.filter(isAvailable),
        contextFiles: (layer.contextFiles ?? []).filter(isAvailable),
        // A bundle without what a phone shows is shown whole, so the layer is never empty.
        phoneFiles: phoneFiles.length > 0 ? phoneFiles : null
      };
    })
    .filter(layer => layer.files.length > 0);
}

// The objects this layer owns from a shared file. Other kinds stay in the file but belong to another layer.
export const entriesForLayer = (layer, entries) => {
  const kindsByFile = layer?.kindsByFile ?? {};
  return entries.filter(({filename, feature}) => !kindsByFile[filename] || kindsByFile[filename].includes(feature.properties.kind));
};

// Which layer's history holds an edit of this file that came from elsewhere: the layer that edits the file itself, or
// else one that changes it along.
export function layerIdOfFile(filename) {
  const owner =
    editorLayers.find(({files}) => files.includes(filename)) ??
    editorLayers.find(({linkedFiles}) => linkedFiles.includes(filename));
  return owner?.id ?? filename;
}

export const layerFiles = layer => [...layer.files, ...layer.linkedFiles];
