import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  checkData,
  checkPlaceMetadata,
  validateBuildingDetailCounts,
  validateBuildingLabels,
  validateBuildingSources,
  validateCollection,
  validateMunicipalities,
  validateRelief,
  validateProtectedAreas,
  protectedAreaTags,
  validateRoadNodes,
  validateRoads, validateSettlementsOfAreas,
  validateStops,
  validateStopsAndRoutes,
  validateTransitNetwork,
  validateTransitRoutes,
  validateTurnRestrictions
} from '../tools/check-data.mjs';
import {entranceBearing} from '../tools/building-entrances.mjs';
import {writeEditorBundle} from '../tools/editor-bundle.mjs';
import {applyVisibility, resolveLevel, validatePolicy, withoutVisibility, placeFactsHash, serializePlaces, run as applyCommand} from '../tools/apply-place-visibility.mjs';
const contractsDirectory = 'packages/contracts';
const fixture = JSON.parse(fs.readFileSync('data/tests/fixtures/podgorica-places.geojson'));
const identitySources = JSON.parse(fs.readFileSync('packages/contracts/fixtures/entity-identity-cases.json')).sources;
const municipalityAreas = JSON.parse(fs.readFileSync('packages/contracts/fixtures/municipality-area-cases.json'));
test('reviewed Podgorica places satisfy the directory contract', () => {
  assert.equal(validateCollection(fixture, {places: true, contractsDirectory}), 3);
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
    assert.throws(() => validateCollection(data, {places: true, contractsDirectory}));
  }
});
test('unclosed polygon rings are rejected', () => {
  assert.throws(() => validateCollection({type: 'FeatureCollection', features: [{type: 'Feature', properties: {},
    geometry: {type: 'Polygon', coordinates: [[[19,42],[20,42],[20,43],[19,43]]]}}]}, {contractsDirectory}), /not closed/);
});

test('municipality file accepts derived unassigned-water areas', () => {
  const collection = structuredClone(municipalityAreas.municipality);
  collection.features.push(structuredClone(municipalityAreas.unassignedWater.features[0]));
  assert.equal(validateMunicipalities(collection, {contractsDirectory}), 2);

  for (const [field, expected] of [
    ['ISO3166-2', /ISO code/],
    ['neighbouringMunicipalities', /neighbouringMunicipalities/],
    ['labelPoint', /labelPoint/]
  ]) {
    const bad = structuredClone(collection);
    if (field === 'ISO3166-2') {
      bad.features[1].properties[field] = 'ME-2';
    } else {
      delete bad.features[1].properties[field];
    }
    assert.throws(() => validateMunicipalities(bad, {contractsDirectory}), expected);
  }
});

test('land and water domain properties, kinds and RFC 7946 ring order are validated', () => {
  const counterClockwiseHole = [[19.2, 42.2], [19.4, 42.2], [19.4, 42.4], [19.2, 42.4], [19.2, 42.2]];
  const data = {
    type: 'FeatureCollection',
    entitySchemaVersion: 1,
    features: [{
      type: 'Feature',
      properties: {
        entityId: 'way/1',
        entityVersion: 1,
        kind: 'meadow',
        osmTag: 'landuse=meadow',
        name: 'Test Meadow',
        'name:en': 'Test Meadow EN',
        destination: true
      },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [[19, 42], [20, 42], [20, 43], [19, 43], [19, 42]],
          [...counterClockwiseHole].reverse()
        ]
      }
    }]
  };
  const options = {
    contractsDirectory,
    allowedKinds: new Set(['meadow']),
    ringKinds: new Set(['meadow']),
    requireRfc7946Rings: true,
    landWater: true,
    requiredOsmTagKinds: new Set(['meadow'])
  };
  assert.equal(validateCollection(data, options), 1);
  for (const [mutate, expected] of [
    [value => {value.features[0].properties.kind = 'forest';}, /unsupported kind forest/],
    [value => {value.features[0].geometry.coordinates[0].reverse();}, /exterior must be counterclockwise/],
    [value => {value.features[0].geometry.coordinates[1] = counterClockwiseHole;}, /hole 0 must be clockwise/],
    [value => {delete value.features[0].properties.osmTag;}, /missing osmTag/],
    [value => {value.features[0].properties.osmTag = 'not a tag';}, /invalid osmTag/],
    [value => {value.features[0].properties.destination = false;}, /destination must be true/]
  ]) {
    const bad = structuredClone(data);
    mutate(bad);
    assert.throws(() => validateCollection(bad, options), expected);
  }
});

test('blank extracted names are rejected while absent names are accepted', () => {
  const data = {
    type: 'FeatureCollection',
    entitySchemaVersion: 1,
    features: [{
      type: 'Feature',
      properties: {
        entityId: 'way/1',
        entityVersion: 1,
        kind: 'meadow',
        osmTag: 'landuse=meadow'
      },
      geometry: {type: 'Point', coordinates: [19, 42]}
    }]
  };
  const options = {
    contractsDirectory,
    allowedKinds: new Set(['meadow']),
    landWater: true,
    requiredOsmTagKinds: new Set(['meadow'])
  };
  assert.equal(validateCollection(data, options), 1);
  for (const field of ['name', 'name:en']) {
    const blank = structuredClone(data);
    blank.features[0].properties[field] = '';
    assert.throws(
      () => validateCollection(blank, options),
      new RegExp(`blank ${field}`)
    );
  }
});

function reviewedCheckRoot(testContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-source-domain-'));
  testContext.after(() => fs.rmSync(root, {recursive: true, force: true}));
  const repositoryRoot = path.resolve(import.meta.dirname, '../..');
  fs.mkdirSync(path.join(root, 'data/sources'), {recursive: true});
  fs.mkdirSync(path.join(root, 'packages'), {recursive: true});
  fs.symlinkSync(path.join(repositoryRoot, 'packages/contracts'), path.join(root, 'packages/contracts'));
  fs.symlinkSync(path.join(repositoryRoot, 'data/artifacts'), path.join(root, 'data/artifacts'));
  const provenance = JSON.parse(
    fs.readFileSync(
      path.join(repositoryRoot, 'data/sources/provenance.json'), 'utf8'
    )
  );
  const sourceFiles = [...new Set([
    ...Object.keys(provenance.layers), 'building-labels.geojson',
    'places.geojson', 'transport-stops.geojson'
  ])];
  const supportingFiles = [
    'building-labels.provenance.json', 'transport-stops.provenance.json',
    'transit-network.json', 'transit-network.provenance.json',
    'transit-routes.json', 'transit-routes.provenance.json',
    'provenance.json', 'place-visibility-policy.json'
  ];
  for (const filename of [...sourceFiles, ...supportingFiles]) {
    fs.symlinkSync(
      path.join(repositoryRoot, 'data/sources', filename),
      path.join(root, 'data/sources', filename)
    );
  }
  return root;
}

test('check-data rejects unsupported kinds and reversed rings in land and water sources', testContext => {
  const root = reviewedCheckRoot(testContext);
  for (const filename of ['land.geojson', 'water.geojson']) {
    const sourcePath = path.join(root, 'data/sources', filename);
    const originalBytes = fs.readFileSync(sourcePath);
    const collection = JSON.parse(originalBytes);
    const featureIndex = collection.features.findIndex(feature => {
      const isPolygon = ['Polygon', 'MultiPolygon'].includes(feature.geometry.type);
      const kind = feature.properties.kind;
      const isPreserved = kind === 'country' || kind === 'context';
      return isPolygon && (filename === 'water.geojson' || !isPreserved);
    });
    assert.ok(featureIndex >= 0, filename);
    const taggedIndex = collection.features.findIndex(feature => {
      const isPolygon = ['Polygon', 'MultiPolygon'].includes(feature.geometry.type);
      return isPolygon && typeof feature.properties.osmTag === 'string';
    });
    assert.ok(taggedIndex >= 0, filename);
    const writeSource = data => {
      fs.unlinkSync(sourcePath);
      fs.writeFileSync(sourcePath, JSON.stringify(data));
    };
    const badKind = structuredClone(collection);
    badKind.features[featureIndex].properties.kind = 'unsupported';
    writeSource(badKind);
    assert.throws(() => checkData(root, {contractsDirectory}), /unsupported kind unsupported/, filename);
    const badRing = structuredClone(collection);
    const geometry = badRing.features[featureIndex].geometry;
    const polygon = geometry.type === 'Polygon' ? geometry.coordinates : geometry.coordinates[0];
    polygon[0].reverse();
    writeSource(badRing);
    assert.throws(() => checkData(root, {contractsDirectory}), /exterior must be counterclockwise/, filename);
    const badTag = structuredClone(collection);
    delete badTag.features[taggedIndex].properties.osmTag;
    writeSource(badTag);
    assert.throws(() => checkData(root, {contractsDirectory}), /missing osmTag/, filename);
    fs.unlinkSync(sourcePath);
    fs.writeFileSync(sourcePath, originalBytes);
  }
});

test('bus stops preserve unique source IDs and reject invalid locations or names', () => {
  const stops = JSON.parse(fs.readFileSync('data/sources/transport-stops.geojson'));
  assert.equal(validateStops(stops, {contractsDirectory}), 719);
  for (const mutate of [
    data => {data.features[1].properties.stopId = data.features[0].properties.stopId;},
    data => {data.features[0].geometry.coordinates = [0, 0];},
    data => {data.features[0].properties.name = '';}
  ]) {
    const data = structuredClone(stops); mutate(data);
    assert.throws(() => validateStops(data, {contractsDirectory}));
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
  assert.equal(validateBuildingLabels(labels,buildings,{contractsDirectory}),provenance.features);
  for(const mutate of [
    data=>{data.features[0].geometry.coordinates=[19,42];},
    data=>{data.features[0].properties['addr:housenumber']='bb';},
    data=>{data.features[0].properties.footprintIndex=-1;},
    data=>{data.features[1].id=data.features[0].id;data.features[1].properties.osm_id=data.features[0].id;}
  ]) {const bad=structuredClone(labels);mutate(bad);assert.throws(()=>validateBuildingLabels(bad,buildings,{contractsDirectory}));}
});

test('building numbers cannot be placed inside a polygon courtyard', () => {
  const label={type:'Feature',id:'way/1',geometry:{type:'Point',coordinates:[19.5,42.5]},properties:{kind:'building',osm_id:'way/1',footprintIndex:0,'addr:housenumber':'1',address_sources:['way/1']}};
  const buildings={type:'FeatureCollection',features:[{geometry:{type:'Polygon',coordinates:[[[19,42],[20,42],[20,43],[19,43],[19,42]],[[19.4,42.4],[19.6,42.4],[19.6,42.6],[19.4,42.6],[19.4,42.4]]]}}]};
  assert.throws(()=>validateBuildingLabels({type:'FeatureCollection',features:[label]},buildings,{contractsDirectory}),/outside its polygon/);
});

test('reviewed building source counts match the extracted provenance', () => {
  const readSource = name => JSON.parse(fs.readFileSync(`data/sources/${name}`));
  const counts = validateBuildingSources(
    readSource('buildings.geojson'), readSource('roads.geojson'),
    readSource('building-entrances.geojson'), readSource('places.geojson'),
    {contractsDirectory}
  );
  const details = JSON.parse(
    fs.readFileSync('data/sources/provenance.json')
  ).building_details;
  validateBuildingDetailCounts(counts, details);
  assert.throws(
    () => validateBuildingDetailCounts(counts, {...details, building: details.building + 1}),
    /building_details.building/
  );
});

test('reviewed places match provenance joins, and a snapshot without joins adds no place counts', () => {
  const readSource = name => JSON.parse(fs.readFileSync(`data/sources/${name}`));
  const buildings = readSource('buildings.geojson');
  const roads = readSource('roads.geojson');
  const entrances = readSource('building-entrances.geojson');
  const places = readSource('places.geojson');
  const details = JSON.parse(fs.readFileSync('data/sources/provenance.json')).building_details;
  const counts = validateBuildingSources(buildings, roads, entrances, places, {contractsDirectory});
  assert.equal(counts.placesInsideBuildings, details.placesInsideBuildings);
  assert.equal(counts.placesOutsideBuildings, details.placesOutsideBuildings);
  const withoutJoins = structuredClone(places);
  for (const feature of withoutJoins.features) delete feature.properties.buildingEntityId;
  const noJoinCounts = validateBuildingSources(buildings, roads, entrances, withoutJoins, {contractsDirectory});
  assert.equal(noJoinCounts.placesInsideBuildings, undefined);
  assert.equal(noJoinCounts.placesOutsideBuildings, undefined);
});

test('building sources validate copied tags, identity joins and no-number rules', () => {
  const validate = sources => validateBuildingSources(
    sources['buildings.geojson'], sources['roads.geojson'],
    sources['building-entrances.geojson'], sources['places.geojson'],
    {contractsDirectory}
  );
  const streetJoinError = /building: street join must list every published road with the same name/;
  const counts = validate(identitySources);
  assert.equal(counts.entrances, 1);
  assert.equal(counts.placesInsideBuildings, 1);
  assert.equal(counts['addr:streetEntityId'], 1);
  assert.equal(counts['addr:streetEntityIds'], 1);
  const invalidCases = [
    {
      name: 'a placeholder house number',
      expected: /building: no-number placeholder must not be a house number/,
      mutate: sources => {
        sources['buildings.geojson'].features[0].properties['addr:housenumber'] = 'bb';
      }
    },
    {
      name: 'a number together with the no-number flag',
      expected: /building: house number and no-number flag are exclusive/,
      mutate: sources => {
        sources['buildings.geojson'].features[0].properties.nohousenumber = 'yes';
      }
    },
    {
      name: 'an invalid no-number flag',
      expected: /building: invalid no-number flag/,
      mutate: sources => {
        const properties = sources['buildings.geojson'].features[0].properties;
        properties.nohousenumber = 'no';
        delete properties['addr:housenumber'];
      }
    },
    {
      name: 'a street join to an unknown road',
      expected: streetJoinError,
      mutate: sources => {
        sources['buildings.geojson'].features[0].properties['addr:streetEntityId'] = 'way/999';
      }
    },
    {
      name: 'a street join after the road was renamed',
      expected: streetJoinError,
      mutate: sources => {
        sources['roads.geojson'].features[0].properties.name = 'Other Street';
      }
    },
    {
      name: 'a unique street name without a join',
      expected: /building: a street name with one published road must be joined/,
      mutate: sources => {
        const properties = sources['buildings.geojson'].features[0].properties;
        delete properties['addr:streetEntityId'];
        delete properties['addr:streetEntityIds'];
      }
    },
    {
      name: 'a join that omits a same-named road',
      expected: streetJoinError,
      mutate: sources => {
        const duplicateRoad = structuredClone(sources['roads.geojson'].features[0]);
        duplicateRoad.properties.entityId = 'way/5';
        sources['roads.geojson'].features.push(duplicateRoad);
      }
    },
    {
      name: 'a representative that is not the lowest member ID',
      expected: streetJoinError,
      mutate: sources => {
        const properties = sources['buildings.geojson'].features[0].properties;
        const duplicateRoad = structuredClone(sources['roads.geojson'].features[0]);
        duplicateRoad.properties.entityId = 'way/5';
        sources['roads.geojson'].features.push(duplicateRoad);
        properties['addr:streetEntityId'] = 'way/5';
        properties['addr:streetEntityIds'] = ['way/4', 'way/5'];
      }
    },
    {
      name: 'a street join with an ambiguous road name',
      expected: streetJoinError,
      mutate: sources => {
        const duplicateRoad = structuredClone(sources['roads.geojson'].features[0]);
        duplicateRoad.properties.entityId = 'way/5';
        sources['roads.geojson'].features.push(duplicateRoad);
      }
    },
    {
      name: 'an entrance linked to an unknown building',
      expected: /entrance: unknown buildingEntityId/,
      mutate: sources => {
        sources['building-entrances.geojson'].features[0].properties.buildingEntityId = 'way/999';
      }
    },
    {
      name: 'a blank entrance type',
      expected: /entrance: invalid entrance type/,
      mutate: sources => {
        sources['building-entrances.geojson'].features[0].properties.entrance = ' ';
      }
    },
    {
      name: 'a placeholder entrance house number',
      expected: /entrance: no-number placeholder must not be a house number/,
      mutate: sources => {
        const properties = sources['building-entrances.geojson'].features[0].properties;
        properties['addr:housenumber'] = 'bez broja';
      }
    },
    {
      name: 'an entrance number together with the no-number flag',
      expected: /entrance: house number and no-number flag are exclusive/,
      mutate: sources => {
        const properties = sources['building-entrances.geojson'].features[0].properties;
        properties['addr:housenumber'] = '12';
        properties.nohousenumber = 'yes';
      }
    },
    {
      name: 'an invalid entrance no-number flag',
      expected: /entrance: invalid no-number flag/,
      mutate: sources => {
        const properties = sources['building-entrances.geojson'].features[0].properties;
        delete properties['addr:housenumber'];
        properties.nohousenumber = 'no';
      }
    },
    {
      name: 'a place linked to an unknown building',
      expected: /place: unknown buildingEntityId/,
      mutate: sources => {
        sources['places.geojson'].features[0].properties.buildingEntityId = 'way/999';
      }
    }
  ];
  for (const invalidCase of invalidCases) {
    const bad = structuredClone(identitySources);
    invalidCase.mutate(bad);
    assert.throws(() => validate(bad), invalidCase.expected, invalidCase.name);
  }
  const noNumberEntrance = structuredClone(identitySources);
  const entranceProperties = noNumberEntrance['building-entrances.geojson'].features[0].properties;
  delete entranceProperties['addr:housenumber'];
  entranceProperties.nohousenumber = 'yes';
  assert.equal(validate(noNumberEntrance)['entrance:nohousenumber'], 1);
  const ambiguous = structuredClone(identitySources);
  const duplicateRoad = structuredClone(ambiguous['roads.geojson'].features[0]);
  duplicateRoad.properties.entityId = 'way/5';
  ambiguous['roads.geojson'].features.push(duplicateRoad);
  const ambiguousProperties = ambiguous['buildings.geojson'].features[0].properties;
  delete ambiguousProperties['addr:streetEntityId'];
  delete ambiguousProperties['addr:streetEntityIds'];
  let ambiguousCounts;
  assert.doesNotThrow(() => {
    ambiguousCounts = validate(ambiguous);
  });
  assert.equal(ambiguousCounts['addr:streetUnjoined'], 1);
  assert.ok(!('addr:streetEntityId' in ambiguousCounts));
});

test('a building joins to every road of a same-named group', () => {
  const sources = structuredClone(identitySources);
  const duplicateRoad = structuredClone(sources['roads.geojson'].features[0]);
  duplicateRoad.properties.entityId = 'way/5';
  sources['roads.geojson'].features.push(duplicateRoad);
  const properties = sources['buildings.geojson'].features[0].properties;
  properties['addr:streetEntityId'] = 'way/4';
  properties['addr:streetEntityIds'] = ['way/4', 'way/5'];
  const counts = validateBuildingSources(
    sources['buildings.geojson'], sources['roads.geojson'],
    sources['building-entrances.geojson'], sources['places.geojson'],
    {contractsDirectory}
  );
  assert.equal(counts['addr:streetEntityId'], 1);
  assert.equal(counts['addr:streetEntityIds'], 1);
});

test('building and label placeholder rules stay identical', () => {
  const rules = JSON.parse(fs.readFileSync('packages/contracts/editor-layers.json')).layers;
  const buildingRule = rules['buildings.geojson'].properties['addr:housenumber'];
  const labelRule = rules['building-labels.geojson'].properties['addr:housenumber'];
  assert.deepEqual(buildingRule.ignoredCharactersPattern, labelRule.ignoredCharactersPattern);
  assert.deepEqual(buildingRule.forbiddenValues, labelRule.forbiddenValues);
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

test('named man-made sights keep their kind rules and the gaps keep none', () => {
  assert.equal(policy.kinds.tower, 4);
  assert.equal(policy.kinds.lighthouse, 4);
  for (const kind of ['bridge', 'gate', 'information']) assert.equal(policy.kinds[kind], undefined);
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
  assert.equal(checkPlaceMetadata(placeBytes, policyBytes, configBytes, provenance, {contractsDirectory}), provenance.places_count);
  const edited = change => { const data = JSON.parse(placeBytes); change(data.features[0]); return serializePlaces(data); };
  assert.throws(() => checkPlaceMetadata(edited(f => {f.properties.visibilityLevel = f.properties.visibilityLevel === 2 ? 3 : 2;}), policyBytes, configBytes, provenance, {contractsDirectory}), /differ from the reviewed policy/);
  assert.throws(() => checkPlaceMetadata(edited(f => {f.geometry.coordinates[0] += 0.001;}), policyBytes, configBytes, provenance, {contractsDirectory}), /provenance mismatch: places_bytes|provenance mismatch: places_sha256/);
  assert.throws(() => checkPlaceMetadata(placeBytes, policyBytes + ' ', configBytes, provenance, {contractsDirectory}), /place_visibility_policy_sha256/);
  assert.throws(() => checkPlaceMetadata(placeBytes, policyBytes, configBytes, {...provenance, places_facts_sha256: '0'}, {contractsDirectory}), /places_facts_sha256/);
  assert.throws(() => checkPlaceMetadata(placeBytes, policyBytes, configBytes, {...provenance, places_count: 0}, {contractsDirectory}), /Place count/);
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
  assert.throws(() => applyCommand(['--check'], {root, contractsDirectory}), /differs from the visibility policy/);
  assert.equal(read(PLACES), JSON.stringify(withoutVisibility(fixture)), '--check writes nothing');
  applyCommand(['--update-provenance'], {root, contractsDirectory});
  assert.doesNotThrow(() => applyCommand(['--check'], {root, contractsDirectory}));
  const reviewed = read(PROVENANCE);
  assert.deepEqual(JSON.parse(reviewed).notes, ['kept']);
  assert.equal(JSON.parse(reviewed).places_count, 3);

  const imported = JSON.parse(read(PLACES)); imported.features[0].geometry.coordinates[0] += 0.001;
  write(PLACES, JSON.stringify(imported));
  assert.throws(() => applyCommand(['--update-provenance'], {root, contractsDirectory}), /Place facts changed/);
  assert.equal(read(PLACES), JSON.stringify(imported));
  assert.equal(read(PROVENANCE), reviewed);
  applyCommand(['--update-provenance', '--accept-new-facts'], {root, contractsDirectory});
  assert.notEqual(JSON.parse(read(PROVENANCE)).places_facts_sha256, JSON.parse(reviewed).places_facts_sha256);
});


test('entrance metadata validates source identity, coordinates, numbering and building association', () => {
  const fixture = JSON.parse(
    fs.readFileSync('packages/contracts/fixtures/building-entrances.json'),
  );
  assert.equal(validateBuildingLabels(fixture.labels, fixture.buildings, {contractsDirectory}), 1);
  const noBuildingNumber = structuredClone(fixture.labels);
  delete noBuildingNumber.features[0].properties.building_number;
  assert.equal(validateBuildingLabels(noBuildingNumber, fixture.buildings, {contractsDirectory}), 1);
  for (const mutate of [
    (properties) => { properties.entrances[0].bearing = 180; },
    (properties) => { delete properties.entrances[0].bearing; },
    (properties) => {
      properties.entrances[0].coordinates = [19, 42];
    },
    (properties) => {
      properties.entrances[0].coordinates = [19.26, 95];
    },
    (properties) => {
      properties.entrances[0].number = 'bb';
    },
    (properties) => {
      properties.entrances[0].ref = ' ';
    },
    (properties) => {
      properties.entrances.push(properties.entrances[0]);
    },
    (properties) => {
      properties.entrances[0].id = 'node/999';
    },
    (properties) => {
      properties.entrances = {};
    },
    (properties) => {
      properties.building_number = 'bb';
    },
  ]) {
    const bad = structuredClone(fixture.labels);
    mutate(bad.features[0].properties);
    assert.throws(() => validateBuildingLabels(bad, fixture.buildings, {contractsDirectory}));
  }
  const unnumbered = structuredClone(noBuildingNumber);
  for (const entrance of unnumbered.features[0].properties.entrances)
    delete entrance.number;
  assert.equal(validateBuildingLabels(unnumbered, fixture.buildings, {contractsDirectory}), 1);
});


test('interior entrance points are rejected even when their wall bearing is correct', () => {
  const fixture = JSON.parse(fs.readFileSync('packages/contracts/fixtures/building-entrances.json'));
  const entrance = fixture.labels.features[0].properties.entrances[0];
  entrance.coordinates = [19.2605, 42.4405];
  entrance.bearing = entranceBearing(entrance.coordinates, fixture.buildings.features[0].geometry);
  assert.throws(() => validateBuildingLabels(fixture.labels, fixture.buildings, {contractsDirectory}), /Entrance must lie on a building wall/);
});

// --- Road graph validation tests ---

test('roads validate pathClass, startNode/endNode, and level integers', () => {
  const roads = JSON.parse(fs.readFileSync('data/sources/roads.geojson'));
  assert.ok(validateRoads(roads, {contractsDirectory}) > 0);
});

test('roads reject invalid pathClass values', () => {
  const roads = JSON.parse(fs.readFileSync('data/sources/roads.geojson'));
  const bad = structuredClone(roads);
  // Find a feature with pathClass and corrupt it
  for (const f of bad.features) {
    if (f.properties.pathClass) {
      f.properties.pathClass = 'invalid';
      break;
    }
  }
  assert.throws(() => validateRoads(bad, {contractsDirectory}), /invalid pathClass/);
});

test('roads reject non-integer startLevel', () => {
  const roads = JSON.parse(fs.readFileSync('data/sources/roads.geojson'));
  const bad = structuredClone(roads);
  for (const f of bad.features) {
    if (f.properties.startLevel !== undefined) {
      f.properties.startLevel = 'not-an-int';
      break;
    }
  }
  assert.throws(() => validateRoads(bad, {contractsDirectory}), /startLevel must be an integer/);
});

test('roads require startNode/endNode and startLevel/endLevel together', () => {
  const roads = JSON.parse(fs.readFileSync('data/sources/roads.geojson'));
  const bad = structuredClone(roads);
  for (const f of bad.features) {
    if (f.properties.startNode !== undefined) {
      delete f.properties.startLevel;
      delete f.properties.endLevel;
      break;
    }
  }
  assert.throws(() => validateRoads(bad, {contractsDirectory}), /must appear together/);
});

test('roads that end at one junction end at one place', () => {
  const roads = JSON.parse(fs.readFileSync('data/sources/roads.geojson'));
  const roadsByNode = Map.groupBy(
    roads.features.filter(({properties}) => properties.startNode !== undefined),
    ({properties}) => properties.startNode
  );
  const [road, other] = [...roadsByNode.values()].find(sharing => sharing.length > 1) ?? [];
  assert.ok(other, 'the sources need two roads at one junction');
  road.geometry.coordinates[0] = [road.geometry.coordinates[0][0] + 0.001, road.geometry.coordinates[0][1]];
  assert.throws(() => validateRoads(roads, {contractsDirectory}), /in different places/);
});

test('a road can end at a junction of the editor, and a turn rule can name both', () => {
  const road = '11111111-1111-4111-8111-111111111111';
  const junction = 'local:22222222-2222-4222-8222-222222222222';
  const roads = JSON.parse(fs.readFileSync('data/sources/roads.geojson'));
  const nodes = JSON.parse(fs.readFileSync('data/sources/road-nodes.geojson'));
  const [first] = roads.features.filter(({properties}) => /^way\/\d+$/.test(properties.entityId));
  const drawn = structuredClone(first);
  Object.assign(drawn.properties, {entityId: `local:${road}`, entityVersion: `sha256:${'a'.repeat(64)}`});
  Object.assign(drawn.properties, {startNode: junction, startLevel: 0});
  roads.features.push(drawn);
  const from = Number(first.properties.entityId.split('/')[1]);
  first.properties.endNode = junction;
  const rule = {entityId: 'relation/1', entityVersion: 1, restriction: 'no_left_turn', from, to: `local:${road}`, viaNodes: [junction]};
  assert.equal(validateTurnRestrictions({entitySchemaVersion: 1, restrictions: [rule]}, roads, nodes).count, 1);
  const missing = {...rule, viaNodes: ['local:33333333-3333-4333-8333-333333333333']};
  assert.throws(
    () => validateTurnRestrictions({entitySchemaVersion: 1, restrictions: [missing]}, roads, nodes),
    /via node local:3333/
  );
  first.properties.endNode = 1;
  assert.throws(
    () => validateTurnRestrictions({entitySchemaVersion: 1, restrictions: [rule]}, roads, nodes),
    /does not end at junction/
  );
  drawn.properties.startNode = 'node/5';
  assert.throws(() => validateRoads(roads, {contractsDirectory}), /startNode must be an OSM number or a local ID/);
});

test('a settlement has at most one area, and an area names a settlement that exists', () => {
  const read = name => JSON.parse(fs.readFileSync(`data/sources/${name}`));
  const areas = read('settlement-areas.geojson');
  const settlements = read('settlements.geojson');
  validateSettlementsOfAreas(areas, settlements);
  const owned = areas.features.filter(({properties}) => properties.settlementEntityId !== undefined);
  const claimedTwice = structuredClone(areas);
  claimedTwice.features.push(structuredClone(owned[0]));
  assert.throws(() => validateSettlementsOfAreas(claimedTwice, settlements), /more than one area/);
  owned[0].properties.settlementEntityId = 'node/1';
  assert.throws(() => validateSettlementsOfAreas(areas, settlements), /settlement node\/1 not found/);
});

test('road-nodes validate kind and OSM identity', () => {
  const nodes = JSON.parse(fs.readFileSync('data/sources/road-nodes.geojson'));
  assert.ok(validateRoadNodes(nodes, {contractsDirectory}) > 0);
});

test('road-nodes reject unknown kind', () => {
  const nodes = JSON.parse(fs.readFileSync('data/sources/road-nodes.geojson'));
  const bad = structuredClone(nodes);
  bad.features[0].properties.kind = 'unknown_kind';
  assert.throws(() => validateRoadNodes(bad, {contractsDirectory}), /unknown road node kind/);
});

test('road-nodes reject duplicate entityId', () => {
  const nodes = JSON.parse(fs.readFileSync('data/sources/road-nodes.geojson'));
  const bad = structuredClone(nodes);
  bad.features[1].properties.entityId = bad.features[0].properties.entityId;
  assert.throws(() => validateRoadNodes(bad, {contractsDirectory}), /duplicate entityId/);
});

test('turn-restrictions validate structure and refs resolve', () => {
  const roads = JSON.parse(fs.readFileSync('data/sources/roads.geojson'));
  const nodes = JSON.parse(fs.readFileSync('data/sources/road-nodes.geojson'));
  const restrictions = JSON.parse(fs.readFileSync('data/sources/turn-restrictions.json'));
  const result = validateTurnRestrictions(restrictions, roads, nodes);
  assert.ok(result.count > 0, 'turn-restrictions.json must not be empty');
});

test('turn-restrictions fail on missing from/to/via refs', () => {
  const roads = JSON.parse(fs.readFileSync('data/sources/roads.geojson'));
  const nodes = JSON.parse(fs.readFileSync('data/sources/road-nodes.geojson'));
  const bad = {entitySchemaVersion: 1, restrictions: [
    {entityId: 'relation/1', entityVersion: 1, restriction: 'no_left_turn', from: 999999999, to: 999999998}
  ]};
  assert.throws(() => validateTurnRestrictions(bad, roads, nodes), /not found in roads\.geojson/);
});

test('turn-restrictions reject invalid entityId format', () => {
  const roads = JSON.parse(fs.readFileSync('data/sources/roads.geojson'));
  const nodes = JSON.parse(fs.readFileSync('data/sources/road-nodes.geojson'));
  const bad = {entitySchemaVersion: 1, restrictions: [
    {entityId: 'invalid', entityVersion: 1, restriction: 'no_left_turn', from: 1, to: 2}
  ]};
  assert.throws(() => validateTurnRestrictions(bad, roads, nodes), /invalid entityId/);
});

test('turn-restrictions reject unknown restriction values', () => {
  const roads = JSON.parse(fs.readFileSync('data/sources/roads.geojson'));
  const nodes = JSON.parse(fs.readFileSync('data/sources/road-nodes.geojson'));
  const bad = {entitySchemaVersion: 1, restrictions: [
    {entityId: 'relation/1', entityVersion: 1, restriction: 'invalid_restriction', from: 1, to: 2}
  ]};
  assert.throws(() => validateTurnRestrictions(bad, roads, nodes), /unknown restriction value/);
});

test('turn-restrictions accept documented OSM restriction values', () => {
  const roads = JSON.parse(fs.readFileSync('data/sources/roads.geojson'));
  const nodes = JSON.parse(fs.readFileSync('data/sources/road-nodes.geojson'));
  const roadWayIds = roads.features
    .map(feature => feature.properties.entityId)
    .filter(id => /^way\/\d+$/.test(id))
    .map(id => Number(id.split('/')[1]));
  const from = roadWayIds[0];
  const to = roadWayIds[1] ?? roadWayIds[0];
  const accepted = {entitySchemaVersion: 1, restrictions: [
    {entityId: 'relation/1', entityVersion: 1, restriction: 'no_entry', from, to},
    {entityId: 'relation/2', entityVersion: 1, restriction: 'no_exit', from, to},
    {entityId: 'relation/3', entityVersion: 1, restriction: 'only_u_turn', from, to},
    {entityId: 'relation/4', entityVersion: 1, restriction: 'no_straight_on', from, to},
  ]};
  assert.doesNotThrow(() => validateTurnRestrictions(accepted, roads, nodes));
});

test('turn-restrictions validate entitySchemaVersion', () => {
  const roads = JSON.parse(fs.readFileSync('data/sources/roads.geojson'));
  const nodes = JSON.parse(fs.readFileSync('data/sources/road-nodes.geojson'));
  assert.throws(() => validateTurnRestrictions({entitySchemaVersion: 0, restrictions: []}, roads, nodes), /missing entitySchemaVersion/);
});

const landContract = JSON.parse(fs.readFileSync('packages/contracts/source-land-water.schema.json'));
const greenKinds = landContract.$defs.landKind.enum.filter(kind => !['country', 'context'].includes(kind));
const landFeatures = JSON.parse(fs.readFileSync('data/sources/land.geojson'));
const greenKindsInLand = [...new Set(landFeatures.features.map(feature => feature.properties.kind))]
  .filter(kind => greenKinds.includes(kind))
  .sort();
const reliefFiles = ['contours.geojson', 'summits.geojson', 'slopes.geojson', 'ridges.geojson', 'canyon-rims.geojson'];
const singleGeometryTypes = {
  'contours.geojson': 'LineString',
  'summits.geojson': 'Point',
  'slopes.geojson': 'Polygon',
  'ridges.geojson': 'LineString',
  'canyon-rims.geojson': 'LineString'
};
const readRelief = filename => JSON.parse(fs.readFileSync(`data/sources/${filename}`));

function assertSortedKeys(value, label) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSortedKeys(item, `${label}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  const keys = Object.keys(value);
  assert.deepEqual(keys, [...keys].sort(), `${label}: keys are not sorted`);
  for (const key of keys) assertSortedKeys(value[key], `${label}.${key}`);
}

test('every relief collection satisfies its read-only domain contract', () => {
  const provenance = JSON.parse(fs.readFileSync('data/sources/provenance.json'));
  for (const filename of reliefFiles) {
    const collection = readRelief(filename);
    assert.equal(validateRelief(collection, {label: filename, contractsDirectory}), provenance.layers[filename].features);
    assert.equal(collection.entitySchemaVersion, 1);
  }
  const contours = readRelief('contours.geojson');
  assert.ok(contours.features.every(feature => feature.properties.index === (feature.properties.elevation % 100 === 0)));
  const ridges = readRelief('ridges.geojson');
  assert.ok(ridges.features.length > 0 && ridges.features.length < 200,
    'ridge boundaries must stay in the tens, not thousands');
  const rims = readRelief('canyon-rims.geojson');
  assert.ok(rims.features.length > 0);
  assert.ok(rims.features.every(feature => ['Morača:left', 'Morača:right', 'Ribnica:left', 'Ribnica:right']
    .includes(`${feature.properties.river}:${feature.properties.bank}`)));
  assert.ok(rims.features.some(feature => Number.isInteger(feature.properties.height)),
    'derived rims carry a measured height');
  assert.ok(rims.features.every(feature =>
    feature.properties.height === undefined || Number.isInteger(feature.properties.height)
  ), 'a rim height is one whole number of metres');
});

test('relief features carry facts only and build parameters live in provenance', () => {
  const provenance = JSON.parse(fs.readFileSync('data/sources/provenance.json'));
  const parameters = provenance.relief.buildParameters;
  assert.deepEqual(parameters.greenKinds, greenKinds);
  assert.deepEqual(parameters.greenKindsPresentInLand, greenKindsInLand);
  assert.deepEqual(provenance.relief.summary.greenKindsPresentInLand, greenKindsInLand);
  assert.equal(parameters.minimumAreaSquareMetres, 2500);
  assert.equal(parameters.ridgeMinimumLengthMetres, 100);
  assert.equal(parameters.summitLinkDistanceMetres, 50);
  assert.equal(parameters.canyonRimJoinGapMetres, 60);
  assert.equal(parameters.canyonRimMinimumLengthMetres, 100);
  assert.equal(parameters.canyonRimHeightStatistic, 'median of sampled bank rise');
  assert.equal(parameters.canyonRimHeightRounding, 'nearest metre, halves upward');
  assert.equal(provenance.relief.retiredBuildParameters.radiusMetres, 400);
  for (const filename of reliefFiles) {
    for (const feature of readRelief(filename).features) {
      const properties = feature.properties;
      assert.equal(properties.source, undefined, `${filename}: source belongs in provenance`);
      assert.equal(properties.greenKinds, undefined, `${filename}: greenKinds belongs in provenance`);
      assert.equal(properties.greenKindsPresentInLand, undefined, `${filename}: discovered green kinds belong in provenance`);
      assert.equal(properties.minimumAreaSquareMetres, undefined, `${filename}: minimum area belongs in provenance`);
      assert.equal(properties.radiusMetres, undefined, `${filename}: ridge radius belongs in provenance`);
      assert.equal('summit' in properties, 'summitName' in properties, `${filename}: summit link and name must appear together`);
    }
  }
});

test('every relief file has sorted keys, sorted identities, and one geometry per feature', () => {
  for (const filename of reliefFiles) {
    const collection = readRelief(filename);
    assertSortedKeys(collection, filename);
    const order = collection.features.map(feature => [
      feature.properties.entityId,
      feature.properties.entityPart ?? -1
    ]);
    const sorted = [...order].sort((first, second) =>
      first[0] < second[0] ? -1 : first[0] > second[0] ? 1 : first[1] - second[1]
    );
    assert.deepEqual(order, sorted, `${filename}: features are not sorted by entityId and entityPart`);
    assert.ok(collection.features.every(feature =>
      feature.geometry.type === singleGeometryTypes[filename]
    ), `${filename}: expected one ${singleGeometryTypes[filename]} per feature`);
  }
});

test('relief validation rejects broken contour, summit and rim facts', () => {
  const mutations = {
    'contours.geojson': [data => {data.features[0].properties.elevation = 25;}, data => {data.features[0].properties.index = !data.features[0].properties.index;}],
    'summits.geojson': [data => {data.features[0].properties.heightCheck = 'unknown';}, data => {data.features[0].properties.mismatch = !data.features[0].properties.mismatch;}, data => {data.features[0].properties.demElevation = 'high';}],
    'slopes.geojson': [data => {data.features[0].properties.aspect = 'unknown';}, data => {data.features[0].properties.greenKinds = ['park'];}],
    'ridges.geojson': [data => {delete data.features[0].properties.sunlitSide;}, data => {data.features[0].properties.radiusMetres = 400;}],
    'canyon-rims.geojson': [data => {data.features[0].properties.bank = 'middle';}, data => {data.features[0].properties.minimumBankRiseMetres = 1;}, data => {data.features[0].properties.source = 'Copernicus DEM GLO-30';}, data => {data.features[0].properties.height = 12.5;}, data => {data.features[0].properties.height = -1;}, data => {data.features[0].properties.height = 2601;}]
  };
  for (const [filename, changes] of Object.entries(mutations)) {
    for (const change of changes) {
      const bad = structuredClone(readRelief(filename));
      change(bad);
      assert.throws(() => validateRelief(bad, {label: filename, contractsDirectory}), undefined, filename);
    }
  }
});

test('the relief contract keeps river and bank off drawn canyon rims', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(contractsDirectory, 'relief.schema.json')));
  const rimProperties = schema.$defs.canyonRim.then.properties;
  const river = rimProperties.river.enum[0];
  const bank = rimProperties.bank.enum[0];
  const validate = new Ajv2020({strict: false}).compile(schema);
  const isValid = properties => validate({
    type: 'FeatureCollection',
    entitySchemaVersion: 1,
    features: [{
      type: 'Feature',
      geometry: {type: 'LineString', coordinates: [[19.4, 42.5], [19.41, 42.51]]},
      properties
    }]
  });
  const drawn = {
    entityId: 'local:00000000-0000-4000-8000-000000000001',
    entityVersion: `sha256:${'a'.repeat(64)}`,
    kind: 'canyon-rim',
    method: 'editor-drawn',
    lengthMetres: 120,
    height: 77
  };
  assert.equal(isValid(drawn), true);
  assert.equal(isValid({...drawn, river}), false);
  assert.equal(isValid({...drawn, bank}), false);
  const derived = {...drawn, entityId: 'way/1', method: 'osm-cliff', river, bank};
  assert.equal(isValid(derived), true);
  const missingRiver = {...derived};
  delete missingRiver.river;
  assert.equal(isValid(missingRiver), false);
});

test('relief validation refuses a drawn rim that names a river or bank', () => {
  const drawn = structuredClone(readRelief('canyon-rims.geojson').features[0]);
  drawn.properties.entityId = 'local:00000000-0000-4000-8000-000000000001';
  drawn.properties.entityVersion = `sha256:${'a'.repeat(64)}`;
  drawn.properties.method = 'editor-drawn';
  drawn.properties.height = 123;
  delete drawn.properties.river;
  delete drawn.properties.bank;
  for (const [field, value] of [['river', 'an unlisted river'], ['bank', 'an unlisted bank']]) {
    const bad = structuredClone(drawn);
    bad.properties[field] = value;
    assert.throws(
      () => validateRelief({type: 'FeatureCollection', entitySchemaVersion: 1, features: [bad]}, {
        label: 'canyon-rims.geojson',
        contractsDirectory
      }),
      error => error.message === `canyon-rims.geojson: a drawn rim cannot name a ${field}`
    );
  }
});

test('relief validation reports an out-of-range rim height with the file and reason', () => {
  const bad = readRelief('canyon-rims.geojson');
  const maximum = JSON.parse(fs.readFileSync(path.join(contractsDirectory, 'relief.schema.json')))
    .$defs.canyonRim.then.properties.height.maximum;
  bad.features[0].properties.height = maximum + 1;
  assert.throws(
    () => validateRelief(bad, {label: 'canyon-rims.geojson', contractsDirectory}),
    error => error.message === 'canyon-rims.geojson: invalid rim height'
  );
});

test('relief validation accepts a locally drawn rim with one measured height', () => {
  const drawn = structuredClone(readRelief('canyon-rims.geojson').features[0]);
  drawn.properties.entityId = 'local:00000000-0000-4000-8000-000000000001';
  drawn.properties.entityVersion = `sha256:${'a'.repeat(64)}`;
  drawn.properties.method = 'editor-drawn';
  drawn.properties.height = 123;
  delete drawn.properties.river;
  delete drawn.properties.bank;
  const collection = {type: 'FeatureCollection', entitySchemaVersion: 1, features: [drawn]};
  assert.equal(validateRelief(collection, {label: 'canyon-rims.geojson', contractsDirectory}), 1);
});

// A protected area is only worth publishing with its name; the label layer relies on this check to skip none.
test('protected-area validation rejects an unnamed area, a wrong kind and an unsupported tag', () => {
  const areas = JSON.parse(fs.readFileSync('data/sources/protected-areas.geojson'));
  assert.equal(validateProtectedAreas(areas, {contractsDirectory}), areas.features.length);
  const mutations = [
    data => {delete data.features[0].properties.name;},
    data => {data.features[0].properties.kind = 'park';},
    data => {data.features[0].properties.osmTag = 'leisure=park';}
  ];
  for (const change of mutations) {
    const bad = structuredClone(areas);
    change(bad);
    assert.throws(() => validateProtectedAreas(bad, {contractsDirectory}));
  }
});

// The extractor and the validator name the same tags; a tag added on one side only would fail the next re-extract.
test('the extractor and check-data accept the same protected-area tags', () => {
  const extractor = fs.readFileSync('data/tools/osm_extract/protected_areas.py', 'utf8');
  const tagList = /PROTECTED_AREA_TAGS = \(([\s\S]*?)\n\)/.exec(extractor)[1];
  const extractorTags = [...tagList.matchAll(/\('(\w+)', '(\w+)'\)/g)].map(([, key, value]) => `${key}=${value}`);
  assert.deepEqual(extractorTags.sort(), [...protectedAreaTags].sort());
});

test('the editor bundle holds the source of every object on the map, relief and transit records included', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-bundle-'));
  t.after(() => fs.rmSync(directory, {recursive: true, force: true}));
  const manifest = await writeEditorBundle('data/sources', directory, 'packages/contracts/editor-bundle.schema.json');
  const filenames = manifest.layers.map(layer => layer.filename);
  const everyGeoJSON = fs.readdirSync('data/sources').filter(name => name.endsWith('.geojson'));
  assert.deepEqual([...filenames].sort(), [...everyGeoJSON, 'transit-routes.json', 'turn-restrictions.json'].sort());
  assert.ok(reliefFiles.every(filename => filenames.includes(filename)));
  assert.deepEqual(fs.readdirSync(directory).sort(), [...filenames, 'manifest.json'].sort());
});

// --- Transit route validation tests ---

test('transit routes validate structure, network types, and direction stops', () => {
  const routes = JSON.parse(fs.readFileSync('data/sources/transit-routes.json'));
  assert.ok(validateTransitRoutes(routes) > 0);
  const cityRoutes = routes.routes.filter(r => r.network === 'bus');
  const intercityRoutes = routes.routes.filter(r => r.network === 'intercity');
  assert.ok(cityRoutes.length > 0, 'Expected city routes');
  // Intercity routes must have OSM identity on each direction
  for (const route of intercityRoutes) {
    for (const direction of route.directions) {
      assert.match(direction.entityId, /^relation\/\d+$/,
        'Intercity direction must have entityId');
      assert.ok(Number.isInteger(direction.entityVersion) && direction.entityVersion >= 1,
        'Intercity direction must have entityVersion');
      // OSM stops must have positions
      for (const stop of direction.stops) {
        if (typeof stop === 'object') {
          assert.ok(Array.isArray(stop.coordinates) && stop.coordinates.length === 2,
            'OSM stop must have coordinates');
        }
      }
    }
  }
});

test('transit routes reject duplicate numbers, invalid colours, and missing fields', () => {
  const routes = JSON.parse(fs.readFileSync('data/sources/transit-routes.json'));
  const cityRoute = routes.routes.find(r => r.number && r.network === 'bus');
  const namedRouteIndex = routes.routes.findIndex(r => r.name && r.name.length > 0);
  for (const mutate of [
    data => { data.routes.push(structuredClone(cityRoute)); }, // duplicate number
    data => { data.routes[0].colour = 'red'; }, // invalid colour format
    data => { data.routes[0].network = 'tram'; }, // invalid network
    data => { data.routes[0].directions[0].stops = ['a']; }, // fewer than 2 stops
    data => { data.routes[namedRouteIndex].name = ''; }, // missing name
  ]) {
    const bad = structuredClone(routes);
    mutate(bad);
    assert.throws(() => validateTransitRoutes(bad));
  }
});

test('stop lines match routes and route stops exist in stops file', () => {
  const stops = JSON.parse(fs.readFileSync('data/sources/transport-stops.geojson'));
  const routes = JSON.parse(fs.readFileSync('data/sources/transit-routes.json'));
  // This should not throw — data is consistent
  validateStopsAndRoutes(stops, routes);
});

test('stop-routes cross-check catches mismatched lines', () => {
  const stops = JSON.parse(fs.readFileSync('data/sources/transport-stops.geojson'));
  const routes = JSON.parse(fs.readFileSync('data/sources/transit-routes.json'));
  // Add a fake line to a stop
  const stopWithFakeLine = structuredClone(stops);
  const firstStopWithLines = stopWithFakeLine.features.find(f => f.properties?.lines);
  if (firstStopWithLines) {
    firstStopWithLines.properties.lines.push('FAKE99');
    assert.throws(() => validateStopsAndRoutes(stopWithFakeLine, routes), /has line FAKE99/);
  }
  // Remove a line from a stop
  const stopMissingLine = structuredClone(stops);
  const firstStopWithLines2 = stopMissingLine.features.find(f => f.properties?.lines && f.properties.lines.length > 0);
  if (firstStopWithLines2) {
    firstStopWithLines2.properties.lines.shift();
    assert.throws(() => validateStopsAndRoutes(stopMissingLine, routes), /missing line/);
  }
});

test('stop-routes cross-check requires both city directions when source has them', () => {
  const stops = JSON.parse(fs.readFileSync('data/sources/transport-stops.geojson'));
  const routes = JSON.parse(fs.readFileSync('data/sources/transit-routes.json'));
  const network = JSON.parse(fs.readFileSync('data/sources/transit-network.json'));
  const routeWithBothDirections = routes.routes.find(route =>
    !route.directions.some(direction => direction.entityId) &&
    (network.patterns || []).some(pattern => pattern.route === route.number && (pattern.sampleTrip || '').includes('_AB_')) &&
    (network.patterns || []).some(pattern => pattern.route === route.number && (pattern.sampleTrip || '').includes('_BA_'))
  );
  assert.ok(routeWithBothDirections, 'expected a city route with both AB and BA source patterns');
  const broken = structuredClone(routes);
  const target = broken.routes.find(route => route.number === routeWithBothDirections.number);
  const removedDirection = target.directions[1];
  target.directions = [target.directions[0]];
  const remainingStopIds = new Set(target.directions.flatMap(direction =>
    direction.stops.map(stop => typeof stop === 'string' ? stop : stop.id)
  ));
  const adjustedStops = structuredClone(stops);
  for (const stop of removedDirection.stops) {
    const stopId = typeof stop === 'string' ? stop : stop.id;
    if (remainingStopIds.has(stopId)) continue;
    const feature = adjustedStops.features.find(entry => entry.id === stopId);
    if (feature?.properties?.lines) {
      feature.properties.lines = feature.properties.lines.filter(line => line !== target.number);
      if (feature.properties.lines.length === 0) delete feature.properties.lines;
    }
  }
  assert.throws(() => validateStopsAndRoutes(adjustedStops, broken, network), /both directions present in source/);
});

test('route number uniqueness allows same number in different source scopes', () => {
  const routes = JSON.parse(fs.readFileSync('data/sources/transit-routes.json'));
  const duplicateAllowed = {
    version: 1,
    retrievedAt: routes.retrievedAt,
    source: routes.source,
    routes: [
      {
        number: '1',
        name: 'City 1',
        network: 'bus',
        directions: [{headsign: 'A', stops: ['a', 'b']}],
      },
      {
        number: '1',
        name: 'OSM 1',
        network: 'bus',
        directions: [{
          entityId: 'relation/999',
          entityVersion: 1,
          headsign: 'A',
          stops: [{id: 'node/1', name: 'A', coordinates: [19.0, 42.0]}, {id: 'node/2', name: 'B', coordinates: [19.1, 42.1]}],
          fromMunicipality: 'ME-08',
          toMunicipality: 'ME-08',
        }],
      },
    ],
  };
  assert.equal(validateTransitRoutes(duplicateAllowed), 2);
});
