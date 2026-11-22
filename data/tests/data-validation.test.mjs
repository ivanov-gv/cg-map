import test from 'node:test';
import assert from 'node:assert/strict';
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
  validateRoadNodes,
  validateRoads,
  validateStops,
  validateTransitNetwork,
  validateTurnRestrictions
} from '../tools/check-data.mjs';
import {entranceBearing} from '../tools/building-entrances.mjs';
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
