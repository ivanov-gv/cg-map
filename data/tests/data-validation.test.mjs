import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateCollection, validateStops, validateTransitNetwork, validateBuildingLabels, checkPlaceMetadata} from '../tools/check-data.mjs';
import {applyVisibility, resolveLevel, validatePolicy, withoutVisibility, placeFactsHash, run as applyCommand} from '../tools/apply-place-visibility.mjs';
const fixture = JSON.parse(fs.readFileSync('data/tests/fixtures/podgorica-places.geojson'));
test('reviewed Podgorica places satisfy the directory contract', () => {
  assert.equal(validateCollection(fixture, {places: true}), 3);
});
test('invalid coordinates, duplicate identities, and unknown categories are rejected', () => {
  for (const mutate of [
    data => {data.features[0].geometry.coordinates[1] = 120;},
    data => {data.features[1].properties.id = data.features[0].properties.id;},
    data => {data.features[0].properties.category = 'unknown';},
    data => {delete data.features[0].properties.visibilityLevel;},
    data => {data.features[0].properties.visibilityLevel = 0;},
    data => {data.features[0].properties.visibilityLevel = 6;},
    data => {data.features[0].properties.visibilityLevel = '1';}
  ]) {
    const data = structuredClone(fixture); mutate(data);
    assert.throws(() => validateCollection(data, {places: true}));
  }
});
test('unclosed polygon rings are rejected', () => {
  assert.throws(() => validateCollection({type: 'FeatureCollection', features: [{type: 'Feature', properties: {},
    geometry: {type: 'Polygon', coordinates: [[[19,42],[20,42],[20,43],[19,43]]]}}]}), /not closed/);
});

test('bus stops preserve unique source IDs and reject invalid locations or names', () => {
  const stops = JSON.parse(fs.readFileSync('data/sources/transport-stops.geojson'));
  assert.equal(validateStops(stops), 719);
  for (const mutate of [
    data => {data.features[1].properties.stopId = data.features[0].properties.stopId;},
    data => {data.features[0].geometry.coordinates = [0, 0];},
    data => {data.features[0].properties.name = '';}
  ]) {
    const data = structuredClone(stops); mutate(data);
    assert.throws(() => validateStops(data));
  }
});

test('transit network rejects missing stops, reversed times, and invalid coordinates', () => {
  const network=JSON.parse(fs.readFileSync('data/sources/transit-network.json'));
  assert.ok(validateTransitNetwork(network)>0);
  for(const mutate of [
    n=>{n.patterns[0].stops[0]='missing-stop';},
    n=>{n.patterns[0].offsets[1]=-1;},
    n=>{Object.values(n.stops)[0].coordinates=[0,0];}
  ]) {const bad=structuredClone(network);mutate(bad);assert.throws(()=>validateTransitNetwork(bad));}
});

test('house-number labels are backed by source IDs and lie inside their building polygons', () => {
  const labels=JSON.parse(fs.readFileSync('data/sources/building-labels.geojson'));
  const buildings=JSON.parse(fs.readFileSync('data/sources/buildings.geojson'));
  const provenance=JSON.parse(fs.readFileSync('data/sources/building-labels.provenance.json'));
  assert.equal(validateBuildingLabels(labels,buildings),provenance.features);
  for(const mutate of [
    data=>{data.features[0].geometry.coordinates=[19,42];},
    data=>{data.features[0].properties['addr:housenumber']='bb';},
    data=>{data.features[0].properties.footprintIndex=-1;},
    data=>{data.features[1].id=data.features[0].id;data.features[1].properties.osm_id=data.features[0].id;}
  ]) {const bad=structuredClone(labels);mutate(bad);assert.throws(()=>validateBuildingLabels(bad,buildings));}
});

test('building numbers cannot be placed inside a polygon courtyard', () => {
  const label={type:'Feature',id:'way/1',geometry:{type:'Point',coordinates:[19.5,42.5]},properties:{kind:'building',osm_id:'way/1',footprintIndex:0,'addr:housenumber':'1',address_sources:['way/1']}};
  const buildings={type:'FeatureCollection',features:[{geometry:{type:'Polygon',coordinates:[[[19,42],[20,42],[20,43],[19,43],[19,42]],[[19.4,42.4],[19.6,42.4],[19.6,42.6],[19.4,42.6],[19.4,42.4]]]}}]};
  assert.throws(()=>validateBuildingLabels({type:'FeatureCollection',features:[label]},buildings),/outside its polygon/);
});

const policy = JSON.parse(fs.readFileSync('data/sources/place-visibility-policy.json'));
const config = JSON.parse(fs.readFileSync('packages/contracts/place-visibility.json'));
const published = JSON.parse(fs.readFileSync('data/sources/places.geojson'));
const editorial = {basis: 'editorial', reviewedBy: 'map editor', reviewedAt: '2026-11-04'};

test('kind rules take precedence over category defaults, with a fallback for the unknown', () => {
  const cases = [
    [{kind: 'museum', category: 'sights'}, 2], [{kind: 'hospital', category: 'essentials'}, 2],
    [{kind: 'pharmacy', category: 'essentials'}, 3], [{kind: 'hotel', category: 'sights'}, 3], [{kind: 'hostel', category: 'stay'}, 3],
    [{kind: 'cafe', category: 'food'}, 4], [{kind: 'supermarket', category: 'shops'}, 4], [{kind: 'mall', category: 'shops'}, 4], [{kind: 'clothes', category: 'shops'}, 5], [{kind: 'gallery', category: 'sights'}, 4], [{kind: 'castle', category: 'sights'}, 4],
    [{kind: 'memorial', category: 'sights'}, 5], [{kind: 'artwork', category: 'sights'}, 5], [{kind: 'atm', category: 'essentials'}, 5], [{kind: 'fuel', category: 'shops'}, 5], [{kind: 'yes', category: 'shops'}, 5],
    [{kind: 'clinic', category: 'essentials'}, 5], [{kind: 'anything', category: 'unmapped'}, 5], [{category: 'food'}, 5], [{kind: '', category: 'food'}, 5], [{kind: 'constructor', category: 'unmapped'}, 5]
  ];
  for (const [properties, level] of cases) assert.equal(resolveLevel(properties, policy), level, JSON.stringify(properties));
});

test('no level 1 place exists without an individually reviewed override', () => {
  assert.equal(published.features.filter(f => f.properties.visibilityLevel === 1).length, 0);
  for (const rules of [policy.kinds, policy.categories]) assert.ok(!Object.values(rules).includes(1));
  assert.throws(() => validatePolicy({...policy, kinds: {museum: 1}}, config, []), /level 1/);
  assert.throws(() => validatePolicy({...policy, categories: {sights: 1}}, config, []), /level 1/);
  assert.throws(() => validatePolicy({...policy, fallbackLevel: 1}, config, []), /level 1/);
});

test('every published place has the level the policy assigns, and only that field differs from the OSM facts', () => {
  const reapplied = applyVisibility(withoutVisibility(published), policy, config);
  assert.deepEqual(reapplied, published);
  const provenance = JSON.parse(fs.readFileSync('data/sources/provenance.json'));
  assert.equal(reapplied.features.length, provenance.places_count);
  assert.equal(placeFactsHash(published), provenance.places_facts_sha256);
  assert.ok(published.features.every(f => Number.isInteger(f.properties.visibilityLevel)));
});

test('overrides apply by stable ID and change nothing else', () => {
  const id = fixture.features[1].properties.id;
  const override = {id, level: 2, reason: 'Reviewed local anchor', provenance: editorial, active: true};
  const result = applyVisibility(fixture, {...policy, overrides: [override]}, config);
  assert.deepEqual(result.features.map(f => f.properties.visibilityLevel), [4, 2, 5]);
  assert.deepEqual(result.features.map(f => f.geometry), fixture.features.map(f => f.geometry));
  assert.equal(applyVisibility(fixture, {...policy, overrides: [{...override, active: false}]}, config).features[1].properties.visibilityLevel, 4);
});

test('invalid, duplicate, orphan, unreviewed, and commercial overrides are rejected', () => {
  const id = fixture.features[1].properties.id, sight = fixture.features[0].properties.id;
  const good = {id, level: 2, reason: 'Reviewed', provenance: editorial, active: true};
  const apply = overrides => applyVisibility(fixture, {...policy, overrides}, config);
  assert.doesNotThrow(() => apply([good]));
  assert.throws(() => apply([{...good, id: 'node/0'}]), /unknown place/);
  assert.throws(() => apply([good, good]), /duplicate/);
  assert.throws(() => apply([{...good, level: 9}]), /unsupported level/);
  assert.throws(() => apply([{...good, reason: ' '}]), /reason/);
  assert.throws(() => apply([{...good, provenance: {basis: 'editorial'}}]), /provenance/);
  assert.throws(() => apply([{...good, active: undefined}]), /active/);
  // Commercial placements stay inactive, and no ordinary business reaches landmark scale.
  const commercial = {...good, provenance: {...editorial, basis: 'commercial'}};
  assert.throws(() => apply([commercial]), /commercial/);
  assert.doesNotThrow(() => apply([{...commercial, active: false}]));
  assert.throws(() => apply([{...good, level: 1}]), /level 1/);
  assert.throws(() => apply([{...commercial, active: false, id: sight, level: 1}]), /level 1/);
  assert.doesNotThrow(() => apply([{...good, id: sight, level: 1}]));
  assert.deepEqual(policy.overrides.filter(o => o.active && o.provenance.basis === 'commercial'), []);
});

test('data checks catch level drift, policy changes, and changed facts', () => {
  const placeBytes = fs.readFileSync('data/sources/places.geojson', 'utf8'), policyBytes = fs.readFileSync('data/sources/place-visibility-policy.json', 'utf8');
  const configBytes = fs.readFileSync('packages/contracts/place-visibility.json', 'utf8'), provenance = JSON.parse(fs.readFileSync('data/sources/provenance.json'));
  assert.equal(checkPlaceMetadata(placeBytes, policyBytes, configBytes, provenance), provenance.places_count);
  const edited = change => { const data = JSON.parse(placeBytes); change(data.features[0]); return JSON.stringify(data); };
  assert.throws(() => checkPlaceMetadata(edited(f => {f.properties.visibilityLevel = f.properties.visibilityLevel === 2 ? 3 : 2;}), policyBytes, configBytes, provenance), /differ from the reviewed policy/);
  assert.throws(() => checkPlaceMetadata(edited(f => {f.geometry.coordinates[0] += 0.001;}), policyBytes, configBytes, provenance), /provenance mismatch: places_bytes|provenance mismatch: places_sha256/);
  assert.throws(() => checkPlaceMetadata(placeBytes, policyBytes + ' ', configBytes, provenance), /place_visibility_policy_sha256/);
  assert.throws(() => checkPlaceMetadata(placeBytes, policyBytes, configBytes, {...provenance, places_facts_sha256: '0'}), /places_facts_sha256/);
  assert.throws(() => checkPlaceMetadata(placeBytes, policyBytes, configBytes, {...provenance, places_count: 0}), /Place count/);
});

test('the apply command checks, writes, and refuses changed facts without touching reviewed files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'place-visibility-'));
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  t.mock.method(console, 'log', () => {});
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true}); fs.writeFileSync(path.join(root, file), text); };
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const PLACES = 'data/sources/places.geojson', PROVENANCE = 'data/sources/provenance.json';
  write(PLACES, JSON.stringify(withoutVisibility(fixture)));
  write(PROVENANCE, '{"notes":["kept"]}\n');
  write('data/sources/place-visibility-policy.json', JSON.stringify(policy));
  write('packages/contracts/place-visibility.json', JSON.stringify(config));
  assert.throws(() => applyCommand(['--check'], root), /differs from the visibility policy/);
  assert.equal(read(PLACES), JSON.stringify(withoutVisibility(fixture)), '--check writes nothing');
  applyCommand(['--update-provenance'], root);
  assert.doesNotThrow(() => applyCommand(['--check'], root));
  const reviewed = read(PROVENANCE);
  assert.deepEqual(JSON.parse(reviewed).notes, ['kept']);
  assert.equal(JSON.parse(reviewed).places_count, 3);

  const imported = JSON.parse(read(PLACES)); imported.features[0].geometry.coordinates[0] += 0.001;
  write(PLACES, JSON.stringify(imported));
  assert.throws(() => applyCommand(['--update-provenance'], root), /Place facts changed/);
  assert.equal(read(PLACES), JSON.stringify(imported));
  assert.equal(read(PROVENANCE), reviewed);
  applyCommand(['--update-provenance', '--accept-new-facts'], root);
  assert.notEqual(JSON.parse(read(PROVENANCE)).places_facts_sha256, JSON.parse(reviewed).places_facts_sha256);
});
