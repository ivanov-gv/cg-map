import {kindLabel, objectName} from './object-names.js';

// What a layer does differently with the objects of one file. Every hook is optional:
//   kind(feature)                 the small label above the name
//   title(feature, context)       the name in the inspector
//   sections(feature)             form sections in order, [{title, fields, isCollapsed}]
//   tools(feature, context)       extra tool buttons, [{label, run(), isDesktopOnly}]
//   renderExtras(container, edit) anything else in the inspector, with edit = {feature, isNew, context, changed(...)}
//   prepared(feature, context)    the feature as Apply will record it
//   problem(feature, context)     why Apply must refuse it, or null
//   companionEdits(edit, context) edits of linked files that belong to this one, [{filename, key, after}]
//   deletion(entry, context)      {message, edits, options: [{label, edits or async resolve()}]}. resolve() may ask for
//                                 more on the map; it gives the edits, or null to keep the object
//   snappedPoint(event, context, feature)   where a placed or drawn point belongs, or null for where it was put
//   limitedGeometry(geometry, edit, context) where a drag must stop
//   measures(feature, before)     lines of facts shown under the form
// The context is {session, rules, levels, map, layer, isPhone(), entriesOf(filename), findEntity(filename, entityId),
// select(entry), startNew(choice), pick(filename, prompt)}. pick asks for an object on the map and gives its entry or null.
const behaviors = new Map();

// Adds what a layer does differently, by file name.
export function registerBehaviors(behaviorByFile) {
  for (const [filename, behavior] of Object.entries(behaviorByFile)) behaviors.set(filename, behavior);
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
  measures: () => []
});

export const behaviorOf = filename => ({...defaultBehavior(filename), ...behaviors.get(filename)});

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
  places: [{label: 'Add POI', filename: 'places.geojson', shape: 'Point', properties: {}}],
  roads: [{label: 'Draw road', filename: 'roads.geojson', shape: 'LineString', properties: {}}],
  green: [{label: 'Draw area', filename: 'land.geojson', shape: 'Polygon', properties: {}}],
  water: [
    {label: 'Draw water area', filename: 'water.geojson', shape: 'Polygon', properties: {}},
    {label: 'Draw river', filename: 'water.geojson', shape: 'LineString', properties: {}}
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
  if (filename === 'transport-stops.geojson') return {id: localId, properties: {stopId: localId}};
  return {properties: {}};
}
