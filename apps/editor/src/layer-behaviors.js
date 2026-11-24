import {kindLabel, objectName} from './object-names.js';

// What a layer does differently with the objects of one file. Every hook is optional:
//   kind(feature)                 the small label above the name
//   title(feature, context)       the name in the inspector
//   sections(feature, edit)       form sections in order, [{title, fields, isCollapsed}]
//   tools(feature, context)       extra tool buttons, [{label, run(), isDesktopOnly}]
//   renderExtras(container, edit) anything else in the inspector, with edit = {feature, isNew, context}
//   prepared(feature, context)    the feature as Apply will record it
//   problem(edit, context)        why Apply must refuse it, or null
//   companionEdits(edit, context) edits of linked files that belong to this one, [{filename, key, after}]
//   deletion(entry, context)      {message, edits, options: [{label, edits or async resolve()}]}. resolve() may ask for
//                                 more on the map; it gives the edits, or null to keep the object
//   snappedPoint(event, context, feature)   where a placed or drawn point belongs, or null for where it was put
//   limitedGeometry(geometry, edit, context) where a drag must stop
//   measures(feature, before)     lines of facts shown under the form
//   controls(edit)                controls that replace single fields, {name: value => element}
//   vertexTools(feature, handle, edit)  what can be done at the picked point, [{id, label, run(), isDisabled}]
//   suggestions(feature, context) usual values of free fields, {name: [value]}
//   applyLabel(edit)              what Apply is called
//   afterApply(entry, context)    what happens once the edit is recorded
//   closesLines                   a drawn line ends on its first point when that is tapped
//   isReshapable(context)         whether its shape can be changed on this screen
//   dragTarget(geometry, context) {feature, label} of what a moved object would belong to, or null
// companionEdits and problem get {filename, key, feature, before, extras}.
// The context is {session, rules, levels, map, layer, isPhone(), entriesOf(filename), findEntity(filename, entityId),
// select(entry), startNew(choice), pick(filename, prompt)}. pick asks for an object on the map and gives its entry or null.
const behaviors = new Map();

const behaviorKey = (filename, layerId) => (layerId ? `${layerId}/${filename}` : filename);

// Adds what a layer does differently, by file name. With a layer, only while that layer is active.
export function registerBehaviors(behaviorByFile, layerId = null) {
  for (const [filename, behavior] of Object.entries(behaviorByFile)) {
    behaviors.set(behaviorKey(filename, layerId), behavior);
  }
}

const defaultBehavior = filename => ({
  kind: () => kindLabel(filename),
  title: feature => objectName(feature, filename),
  sections: () => null,
  tools: () => [],
  renderExtras: () => {},
  prepared: feature => feature,
  problem: () => null,
  companionEdits: () => [],
  deletion: () => ({message: '', edits: []}),
  measures: () => [],
  suggestions: () => ({}),
  controls: () => ({}),
  vertexTools: () => [],
  applyLabel: () => 'Apply',
  afterApply: () => {},
  isReshapable: () => true,
  dragTarget: () => null
});

export const behaviorOf = (filename, layerId = null) => ({
  ...defaultBehavior(filename),
  ...behaviors.get(filename),
  ...behaviors.get(behaviorKey(filename, layerId))
});

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
    {label: 'Draw path', filename: 'roads.geojson', shape: 'LineString', properties: {kind: 'path'}}
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
  settlements: [
    {label: 'Add town', filename: 'settlements.geojson', shape: 'Point', properties: {kind: 'settlement'}}
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
