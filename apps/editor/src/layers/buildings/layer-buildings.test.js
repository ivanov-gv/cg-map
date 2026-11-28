import test from 'node:test';
import assert from 'node:assert/strict';
import {interiorPoint, isInside} from '../../geometry/interior-point.js';
import {buildingBehaviors, nextEntranceNumber} from './layer-buildings.js';

const square = (west, south, size) => [
  [west, south],
  [west + size, south],
  [west + size, south + size],
  [west, south + size],
  [west, south]
];
const rounded = ([longitude, latitude]) => [longitude, latitude].map(value => Math.round(value * 1e6) / 1e6);
const buildingFeature = (west = 19.25, properties = {}) => ({
  type: 'Feature',
  properties: {kind: 'building', building: 'yes', entityId: 'way/1', ...properties},
  geometry: {type: 'Polygon', coordinates: [square(west, 42.44, 0.001)]}
});
const pointFeature = (properties, coordinates) => ({
  type: 'Feature',
  properties,
  geometry: {type: 'Point', coordinates}
});
const label = pointFeature(
  {
    kind: 'building',
    footprintIndex: 0,
    'addr:housenumber': '14',
    entrances: [{id: 'node/5', coordinates: [19.25, 42.4405], bearing: 90}]
  },
  [19.2505, 42.4405]
);
const entrance = pointFeature({kind: 'entrance', entrance: 'main', ref: '1', buildingEntityId: 'way/1'}, [19.2505, 42.44]);
const place = pointFeature({name: 'Cafe', kind: 'cafe', buildingEntityId: 'way/1'}, [19.2509, 42.4409]);

function contextWith(featuresByFile, picked = null) {
  const entriesOf = filename =>
    (featuresByFile[filename] ?? []).map((feature, index) => ({filename, key: String(index), feature}));
  return {
    entriesOf,
    findEntity: (filename, entityId) => entriesOf(filename).find(({feature}) => feature.properties.entityId === entityId),
    pick: async () => picked
  };
}

const fullContext = picked =>
  contextWith(
    {
      'buildings.geojson': [buildingFeature()],
      'building-labels.geojson': [label],
      'building-entrances.geojson': [entrance],
      'places.geojson': [place]
    },
    picked
  );
const behavior = buildingBehaviors['buildings.geojson'];
const companions = (before, after, context = fullContext()) =>
  behavior.companionEdits({key: '0', feature: after, before}, context);
const editOf = (edits, filename) => edits.find(edit => edit.filename === filename)?.after;

test('a moved building takes its label, its entrances and the places inside with it', () => {
  const edits = companions(buildingFeature(), buildingFeature(19.251));
  const movedLabel = editOf(edits, 'building-labels.geojson');
  assert.deepEqual(rounded(movedLabel.geometry.coordinates), [19.2515, 42.4405]);
  assert.deepEqual(rounded(movedLabel.properties.entrances[0].coordinates), [19.251, 42.4405]);
  assert.deepEqual(rounded(editOf(edits, 'building-entrances.geojson').geometry.coordinates), [19.2515, 42.44]);
  assert.deepEqual(rounded(editOf(edits, 'places.geojson').geometry.coordinates), [19.2519, 42.4409]);
});

test('after a corner edit entrances return to the outline and what fell outside comes back in', () => {
  const narrowed = {...buildingFeature(), geometry: {type: 'Polygon', coordinates: [square(19.25, 42.44, 0.0004)]}};
  const edits = companions(buildingFeature(), narrowed);
  const rings = narrowed.geometry.coordinates;
  assert.ok(isInside(editOf(edits, 'building-labels.geojson').geometry.coordinates, rings));
  assert.ok(isInside(editOf(edits, 'places.geojson').geometry.coordinates, rings));
  assert.deepEqual(rounded(editOf(edits, 'building-entrances.geojson').geometry.coordinates), [19.2504, 42.44]);
});

test('the address of a building and its label stay one address', () => {
  const numbered = buildingFeature(19.25, {'addr:housenumber': '16', 'addr:street': 'Main street'});
  const changed = companions(buildingFeature(19.25, {'addr:housenumber': '14'}), numbered);
  const {properties} = editOf(changed, 'building-labels.geojson');
  assert.deepEqual([properties['addr:housenumber'], properties['addr:street']], ['16', 'Main street']);

  const withoutLabel = contextWith({'buildings.geojson': [buildingFeature()]});
  const added = editOf(companions(buildingFeature(), numbered, withoutLabel), 'building-labels.geojson');
  assert.equal(added.properties.buildingEntityId, 'way/1');
  assert.ok(isInside(added.geometry.coordinates, buildingFeature().geometry.coordinates));

  const onlyNumber = pointFeature({kind: 'building', footprintIndex: 0, 'addr:housenumber': '14'}, [19.2505, 42.4405]);
  const onlyNumberContext = contextWith({'building-labels.geojson': [onlyNumber]});
  const [removed] = companions(buildingFeature(19.25, {'addr:housenumber': '14'}), buildingFeature(), onlyNumberContext);
  assert.equal(removed.after, null, 'a label with nothing left to say goes');
});

test('a building marked as having no number loses its number', () => {
  const contradicting = buildingFeature(19.25, {nohousenumber: 'yes', 'addr:housenumber': '14'});
  assert.equal(behavior.prepared(contradicting).properties['addr:housenumber'], undefined);
});

test('deleting a building takes its address and entrances, and asks about the places inside', async () => {
  const target = {
    filename: 'buildings.geojson',
    key: '7',
    feature: {...buildingFeature(19.26), properties: {entityId: 'way/7', kind: 'building'}}
  };
  const building = {filename: 'buildings.geojson', key: '0', feature: buildingFeature()};
  const {edits, options, message} = behavior.deletion(building, fullContext(target));
  assert.match(message, /Cafe/);
  assert.deepEqual(
    edits.map(({filename, after}) => [filename, after]),
    [
      ['building-labels.geojson', null],
      ['building-entrances.geojson', null]
    ]
  );
  const [move, remove] = options;
  const [moved] = await move.resolve();
  assert.equal(moved.after.properties.buildingEntityId, 'way/7');
  assert.ok(isInside(moved.after.geometry.coordinates, target.feature.geometry.coordinates));
  assert.deepEqual(remove.edits, [{filename: 'places.geojson', key: '0', after: null}]);
  const keepsWhenCancelled = behavior.deletion(building, fullContext(null)).options[0];
  assert.equal(await keepsWhenCancelled.resolve(), null);
});

test('an entrance is always on the outline of its building', () => {
  const entranceBehavior = buildingBehaviors['building-entrances.geojson'];
  const event = {lngLat: {toArray: () => [19.2505, 42.4398]}};
  assert.deepEqual(rounded(entranceBehavior.snappedPoint(event, fullContext(), entrance)), [19.2505, 42.44]);
  const dragged = entranceBehavior.limitedGeometry(
    {type: 'Point', coordinates: [19.2514, 42.4405]},
    {feature: entrance},
    fullContext()
  );
  assert.deepEqual(rounded(dragged.coordinates), [19.251, 42.4405]);
});

test('an interior point is inside a shape whose centre is not', () => {
  const courtyard = [square(19.25, 42.44, 0.001), square(19.2503, 42.4403, 0.0004).toReversed()];
  assert.ok(isInside(interiorPoint(courtyard), courtyard));
  const hook = [
    [
      [19.25, 42.44],
      [19.251, 42.44],
      [19.251, 42.441],
      [19.2508, 42.441],
      [19.2508, 42.4402],
      [19.25, 42.4402],
      [19.25, 42.44]
    ]
  ];
  assert.ok(isInside(interiorPoint(hook), hook));
});

test('a new entrance gets the next number after the ones already on the building', () => {
  const entranceWith = ref => ({feature: pointFeature({kind: 'entrance', ref}, [19.2505, 42.44])});
  assert.equal(nextEntranceNumber([]), '1');
  assert.equal(nextEntranceNumber([entranceWith('1'), entranceWith('2')]), '3');
  assert.equal(nextEntranceNumber([entranceWith('7'), entranceWith('side')]), '8');
});

test('the inspector title stays short, while an overlap says what an untitled building is', () => {
  assert.equal(behavior.title(buildingFeature()), 'No address');
  assert.equal(behavior.overlapTitle(buildingFeature()), 'a building without an address');
  assert.equal(behavior.title(buildingFeature(19.25, {name: 'Corner cafe'})), 'Corner cafe');
  assert.equal(behavior.overlapTitle(buildingFeature(19.25, {name: 'Corner cafe'})), 'Corner cafe');
  assert.equal(
    behavior.title(buildingFeature(19.25, {'addr:street': 'Main street', 'addr:housenumber': '14'})),
    'Main street 14'
  );
  assert.equal(
    behavior.overlapTitle(buildingFeature(19.25, {'addr:street': 'Main street', 'addr:housenumber': '14'})),
    'Main street 14'
  );
});
