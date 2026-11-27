import {isArea} from '../../geometry/area-magnet.js';
import {kindLabel, objectName} from './object-names.js';

// What a layer does differently with the objects of one file. Every hook is optional:
//   kind(feature), title(feature, context)      the small label and the name in the inspector
//   overlapTitle(feature, context)              the name in the overlap notice, when it needs more than the title
//   sections(feature, edit)                     form sections in order, [{title, fields, isCollapsed}]
//   controls(edit)                              controls that replace single fields, {name: value => element}
//   usualValues(feature, context)               what free fields usually say, offered as a list, {name: [value]}
//   listsDependOn                               fields whose choice changes those lists
//   measures(feature, before)                   lines of facts shown under the form
//   renderExtras(container, edit)               anything else in the inspector
//   tools(feature, edit)                        extra tool buttons, [{label, run(), isDesktopOnly}]
//   vertexTools(feature, handle, edit)          what can be done at the picked point, [{id, label, run(), isDisabled}]
//   joinsLines                                  whether the points of this line join others
//   joinedPoints(entry, context)                the points of a line that others share
//   marks(feature)                              letters on the map for the picked object, [{coordinate, label}]
//   isDerived                                   it only stands for others: Apply records its companion edits, not itself
//   isViewOnly(context)                         the object can be read and not changed here
//   isReshapable(context)                       whether its shape can be changed on this screen
//   snappedPoint(event, context, feature)       where a placed or drawn point belongs, or null for where it was put
//   limitedGeometry(geometry, change, context)  where a drag must stop, with change = {key, feature, previousGeometry,
//                                             origins, draggedIndex}, the point of a line that is dragged or null
//   hasMagnet(feature, isDrawingOutline)        whether its points go to what is close; areas and outlines do by default
//   mayContainOthers                            whether an area inside another one is no overlap
//   closesLines                                 a drawn line ends on its first point when that is tapped
//   dragTarget(geometry, context)               {feature, label} of what a moved object would belong to, or null
//   prepared(feature, context, edit)            the feature as Apply will record it
//   problem(change, context)                    why Apply must refuse it, or null
//   companionEdits(change, context)             edits of linked files that belong to it, [{filename, key, after}]
//   record({key, feature}, context)             keeps the object somewhere else than in a source file
//   applyLabel(edit)                            what Apply is called
//   afterApply(entry, context)                  what happens once the edit is recorded
//   deletion(entry, context)                    {problem} when it must stay, else {message, edits, options}. Options are
//                                               [{label, edits or async resolve()}]; resolve() may ask for more on the
//                                               map and gives the edits, or null to keep the object
// problem and companionEdits get change = {filename, key, feature, before, extras, origins}; origins are those of
// line-origins.js. An edit is the open one, as InspectorEditing describes it in #editContext. The context is what app.js
// gives in behaviorContext().
const behaviors = new Map();

const behaviorKey = (filename, layerId) => (layerId ? `${layerId}/${filename}` : filename);

// Adds what a layer does differently, by file name. With a layer, only while that layer is active.
export function registerBehaviors(behaviorByFile, layerId = null) {
  for (const [filename, behavior] of Object.entries(behaviorByFile)) {
    behaviors.set(behaviorKey(filename, layerId), behavior);
  }
}

const defaultBehavior = (filename, layerId) => ({
  kind: () => kindLabel(filename),
  title: feature => objectName(feature, filename),
  overlapTitle: (feature, context) => behaviorOf(filename, layerId).title(feature, context),
  sections: () => null,
  tools: () => [],
  renderExtras: () => {},
  prepared: feature => feature,
  problem: () => null,
  companionEdits: () => [],
  deletion: () => ({message: '', edits: []}),
  measures: () => [],
  controls: () => ({}),
  vertexTools: () => [],
  joinsLines: false,
  joinedPoints: () => [],
  marks: () => [],
  isDerived: false,
  isReshapable: () => true,
  hasMagnet: (feature, isDrawingOutline) => isDrawingOutline || isArea(feature.geometry),
  mayContainOthers: true,
  isViewOnly: () => false,
  usualValues: () => ({}),
  listsDependOn: [],
  applyLabel: () => 'Apply',
  afterApply: () => {},
  dragTarget: () => null
});

export const behaviorOf = (filename, layerId = null) => ({
  ...defaultBehavior(filename, layerId),
  ...behaviors.get(filename),
  ...behaviors.get(behaviorKey(filename, layerId))
});

// What every behavior hook may read. The host supplies the session, rules and callbacks; findEntity stays here so a
// behavior never has to know how a source entry keeps its identity. hasFile tells hooks which sources a bundle carries;
// it defaults to true so a behavior tested on its own still sees the files it asks about.
export function createBehaviorContext({
  session,
  rules,
  levels,
  map,
  layer,
  isPhone,
  isMagnetOn,
  entriesOf,
  hasFile = () => true,
  shownLevel,
  select,
  startNew,
  pick,
  pickPoint,
  saveSketch,
  showPath,
  showNextGap
}) {
  return {
    session,
    rules,
    levels,
    map,
    layer,
    isPhone,
    isMagnetOn,
    entriesOf,
    hasFile,
    findEntity: (filename, entityId) =>
      entriesOf(filename).find(({key, feature}) => key === entityId || feature.properties.entityId === entityId),
    shownLevel,
    select,
    startNew,
    pick,
    pickPoint,
    saveSketch,
    showPath,
    showNextGap
  };
}

// What can be added on each layer. properties are the facts the choice itself states.
const drawChoices = {
  buildings: [
    {
      label: 'Draw building',
      filename: 'buildings.geojson',
      shape: 'Polygon',
      properties: {kind: 'building', building: 'yes'}
    }
  ],
  places: [{label: 'Add place', filename: 'places.geojson', shape: 'Point', properties: {}}],
  roads: [
    {label: 'Draw road', filename: 'roads.geojson', shape: 'LineString', properties: {}},
    {label: 'Draw path', filename: 'roads.geojson', shape: 'LineString', properties: {kind: 'path'}},
    {
      label: 'Draw bridge',
      filename: 'bridges.geojson',
      shape: 'Polygon',
      // An outline drawn here is traced, not imported from OpenStreetMap.
      properties: {kind: 'bridge', method: 'traced'}
    }
  ],
  green: [
    {label: 'Draw area', filename: 'land.geojson', shape: 'Polygon', properties: {}},
    {
      label: 'Draw protected area',
      filename: 'protected-areas.geojson',
      shape: 'Polygon',
      properties: {kind: 'protected-area', osmTag: 'boundary=protected_area'}
    }
  ],
  water: [
    {label: 'Draw water area', filename: 'water.geojson', shape: 'Polygon', properties: {}},
    {label: 'Draw river', filename: 'water.geojson', shape: 'LineString', properties: {}}
  ],
  relief: [
    {
      label: 'Draw contour',
      filename: 'contours.geojson',
      shape: 'LineString',
      properties: {kind: 'contour', index: false},
      isDesktopOnly: true
    },
    {
      label: 'Add summit',
      filename: 'summits.geojson',
      shape: 'Point',
      properties: {kind: 'summit', natural: 'peak'}
    }
  ],
  stops: [{label: 'Add stop', filename: 'transport-stops.geojson', shape: 'Point', properties: {}}],
  railways: [
    {
      label: 'Add station',
      filename: 'railways.geojson',
      shape: 'Point',
      properties: {kind: 'station', osmTag: 'railway=station'}
    },
    {
      label: 'Add halt',
      filename: 'railways.geojson',
      shape: 'Point',
      properties: {kind: 'halt', osmTag: 'railway=halt'}
    },
    {
      label: 'Draw rail',
      filename: 'railways.geojson',
      shape: 'LineString',
      properties: {kind: 'rail', osmTag: 'railway=rail'}
    },
    {
      label: 'Draw disused rail',
      filename: 'railways.geojson',
      shape: 'LineString',
      properties: {kind: 'disused_rail', osmTag: 'disused:railway=rail'}
    },
    {
      label: 'Draw platform',
      filename: 'railways.geojson',
      shape: 'Polygon',
      properties: {kind: 'platform', osmTag: 'railway=platform'}
    }
  ],
  routes: [
    {
      label: 'New line',
      filename: 'transit-routes.json',
      shape: 'None',
      properties: {network: 'bus', directions: [{headsign: '', stops: []}]},
      isDesktopOnly: true
    }
  ],
  settlements: [
    {label: 'Add town', filename: 'settlements.geojson', shape: 'Point', properties: {kind: 'settlement'}},
    {
      label: 'Draw settlement area',
      filename: 'settlement-areas.geojson',
      shape: 'Polygon',
      properties: {kind: 'settlement-area'},
      isDesktopOnly: true
    }
  ]
};

// Only what the rules of the file allow to add.
export function drawChoicesOf(layer, rules) {
  return (drawChoices[layer?.id] ?? []).filter(
    ({filename}) => layer.files.includes(filename) && rules.layers[filename].operations.includes('add')
  );
}

// A new object states its own identity where the contract asks for it: a place and a stop carry their local ID.
export function newFeatureFields(filename, localId, rules) {
  if (filename === 'places.geojson') return {properties: {id: localId, source: rules.localPlaceSource}};
  if (filename === 'settlements.geojson') return {properties: {source: rules.localPlaceSource}};
  if (filename === 'transport-stops.geojson') return {id: localId, properties: {stopId: localId}};
  return {properties: {}};
}
