// One published layer contract for the tile builder, the PMTiles packager and archive acceptance tests.
// The builder selects source fields with this table and the packager emits its metadata from the same table,
// so TileJSON cannot advertise a field or a zoom that the encoded tiles do not carry.

export const ARCHIVE_NAME = 'Kompas Montenegro vector PoC';
export const MAX_TILE_ZOOM = 17;
export const MAX_GENERATED_ZOOM = 16;

const CONTOUR_FULL_DETAIL_ZOOM = 14;
const MINOR_SUMMIT_ZOOM = 13;
const PATH_DETAIL_ZOOM = 14;
const ROAD_LOCAL_ZOOM = 11;
const ROAD_MINOR_ZOOM = 9;
const SETTLEMENT_RANK_ZOOMS = {capital: 5, city: 5, town: 8, village: 11};
const SETTLEMENT_OTHER_ZOOM = 13;

const LOW_ZOOM_ROAD_KINDS = [
  'motorway', 'trunk', 'primary', 'secondary',
  'motorway_link', 'trunk_link', 'primary_link'
];
const MID_ZOOM_EXCLUDED_ROAD_KINDS = new Set([
  'residential', 'service', 'footway', 'path', 'steps', 'track', 'pedestrian', 'living_street'
]);
const PATH_KINDS = new Set(['footway', 'pedestrian', 'path', 'track', 'cycleway', 'steps']);

// Keep the older low-zoom road thinning, then hold walking routes back until the detail zooms.
function keepRoad(tags, zoom) {
  if (zoom < ROAD_MINOR_ZOOM) return LOW_ZOOM_ROAD_KINDS.includes(tags.kind);
  if (zoom < ROAD_LOCAL_ZOOM) return !MID_ZOOM_EXCLUDED_ROAD_KINDS.has(tags.kind);
  if (zoom < PATH_DETAIL_ZOOM) return !PATH_KINDS.has(tags.kind);
  return true;
}

function settlementZoom(tags) {
  return SETTLEMENT_RANK_ZOOMS[tags.rank] ?? SETTLEMENT_OTHER_ZOOM;
}

export const TILE_LAYERS = [
  {
    name: 'land',
    sourceFile: 'land.geojson',
    minZoom: 0,
    // kind selects the green fill; names label green areas and countries; destination marks a valued meadow.
    fields: ['kind', 'name', 'name:en', 'destination']
  },
  {
    name: 'water',
    sourceFile: 'water.geojson',
    minZoom: 0,
    // kind separates fills, waterways and coastlines; names label rivers and lakes.
    fields: ['kind', 'name', 'name:en', 'tunnel']
  },
  {
    name: 'roads',
    sourceFile: 'roads.geojson',
    minZoom: 0,
    // Display needs the road kind, name, structure, one-way state, path class, lighting and end levels.
    // inGreenArea is derived by the tile builder (green-areas.mjs), not stored in the source.
    fields: [
      'kind', 'name', 'name:en', 'bridge', 'tunnel', 'layer',
      'oneway', 'pathClass', 'lit', 'startLevel', 'endLevel', 'inGreenArea'
    ],
    keep: keepRoad
  },
  {
    name: 'buildings',
    sourceFile: 'buildings.geojson',
    minZoom: 13,
    // All other building tags stay in the source for the editor; tiles carry only kind and building levels.
    fields: ['kind', 'building:levels']
  },
  {
    name: 'contours',
    sourceFile: 'contours.geojson',
    minZoom: 12,
    // elevation draws each 20 m line and index keeps the 100 m lines readable at the first relief zoom.
    fields: ['elevation', 'index'],
    keep: (tags, zoom) => zoom >= CONTOUR_FULL_DETAIL_ZOOM || tags.index === true
  },
  {
    name: 'slopes',
    sourceFile: 'slopes.geojson',
    minZoom: 12,
    // aspect selects the lit or shaded tone inside a green area.
    fields: ['aspect']
  },
  {
    name: 'ridges',
    sourceFile: 'ridges.geojson',
    minZoom: 14,
    // The two sides tell a future style which tones meet at this line.
    fields: ['sunlitSide', 'shadedSide', 'summitName']
  },
  {
    name: 'canyon_rims',
    sourceFile: 'canyon-rims.geojson',
    minZoom: 13,
    // river and bank identify the canyon edge; height and width are optional properties.
    fields: ['river', 'bank', 'height', 'width']
  },
  {
    name: 'summits',
    sourceFile: 'summits.geojson',
    minZoom: 9,
    // names and OSM/DEM elevations are the display facts; heightCheck keeps a reported mismatch visible.
    fields: ['name', 'name:en', 'ele', 'demElevation', 'heightCheck'],
    keep: (tags, zoom) => zoom >= MINOR_SUMMIT_ZOOM || Boolean(tags.name)
  },
  {
    name: 'protected_areas',
    sourceFile: 'protected-areas.geojson',
    minZoom: 10,
    // Named protected areas are picked by name on the map; they are no land cover, so a style draws no fill for them.
    fields: ['kind', 'name', 'name:en']
  },
  {
    name: 'green_area_labels',
    sourceFile: 'land.geojson',
    minZoom: 13,
    // The tile builder derives one long-axis line per named green area and per named protected area
    // (green-area-labels.mjs, protected-areas.geojson) for its name label.
    fields: ['name', 'name:en']
  },
  {
    name: 'settlements',
    sourceFile: 'settlements.geojson',
    minZoom: Math.min(...Object.values(SETTLEMENT_RANK_ZOOMS), SETTLEMENT_OTHER_ZOOM),
    // rank drives the zoom ladder and names drive the town labels; population stays in the source.
    fields: ['name', 'name:en', 'rank'],
    keep: (tags, zoom) => zoom >= settlementZoom(tags)
  },
  {
    name: 'borders',
    sourceFile: 'border-edges.geojson',
    minZoom: 6,
    // Each shared edge is drawn once, with the name or municipality code on either side.
    fields: ['left', 'right']
  },
  {
    name: 'municipalities',
    sourceFile: 'municipalities.geojson',
    minZoom: 8,
    // The source is a shared-edge polygon; only its reviewed label point is a display feature.
    fields: ['name', 'name:en']
  },
  {
    name: 'road_nodes',
    sourceFile: 'road-nodes.geojson',
    minZoom: 16,
    // Crossings and traffic signals need only their kind and an optional name.
    fields: ['kind', 'name']
  },
  {
    name: 'entrances',
    sourceFile: 'building-entrances.geojson',
    minZoom: 16,
    // Entrance type, reference, floor and step-free state are the fields an inspector can display.
    fields: ['entrance', 'ref', 'level', 'door', 'wheelchair']
  }
];

// TileJSON describes every field as a string; the array of fields is the authoritative part.
export function tileLayerMetadata() {
  return {
    name: ARCHIVE_NAME,
    vector_layers: TILE_LAYERS.map(layer => ({
      id: layer.name,
      fields: Object.fromEntries(layer.fields.map(field => [field, ''])),
      minzoom: layer.minZoom,
      maxzoom: MAX_TILE_ZOOM
    }))
  };
}
