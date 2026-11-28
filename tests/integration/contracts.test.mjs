import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {dataSourcePath, dataToolURL} from '../data-root.mjs';
import {
  contractPath,
  contractsDirectory,
  publishedContractsRoot,
  readContractJSON
} from '../contracts-root.mjs';
import {categories} from '../../apps/web/src/shared/core.js';
import {parseVisibilityConfig, normalizePlaces, assertPublishedPlaces} from '../../dist/web/map-core/place-visibility.js';

test('web categories agree with the published place contract', () => {
  const contract = readContractJSON('places.schema.json');
  assert.deepEqual(Object.keys(categories).filter(key => key !== 'all').sort(), contract.properties.properties.properties.category.enum.slice().sort());
});

test('the backend keeps a byte-identical copy of the pinned direction fixture', () => {
  const pinnedFixture = path.join(publishedContractsRoot(), 'fixtures/vehicle-direction-cases.json');
  const backendCopy = new URL(
    '../../services/backend/internal/service/vehicles/testdata/vehicle-direction-cases.json',
    import.meta.url
  );
  assert.deepEqual(fs.readFileSync(backendCopy), fs.readFileSync(pinnedFixture));
});

test('producer and consumer share one visibility configuration and the published snapshot satisfies it', () => {
  const raw = fs.readFileSync(contractPath('place-visibility.json'));
  const config = parseVisibilityConfig(JSON.parse(raw));
  const levelSchema = readContractJSON('places.schema.json').properties.properties.properties.visibilityLevel;
  assert.deepEqual([levelSchema.minimum, levelSchema.maximum], [config.levels[0], config.levels.at(-1)]);
  const places = JSON.parse(fs.readFileSync(dataSourcePath('places.geojson'))).features;
  assert.doesNotThrow(() => assertPublishedPlaces(places, config));
  assert.equal(normalizePlaces(places, config).length, places.length);
  assert.deepEqual(fs.readFileSync('dist/web/data/place-visibility.json'), raw);
  assert.ok(JSON.parse(fs.readFileSync('dist/web/data/manifest.json')).shell.includes('data/place-visibility.json'));
});


test('producer and browser agree on separate building numbers and located entrances', async () => {
  const { validateBuildingLabels } =
    await import(dataToolURL('check-data.mjs'));
  const {
    buildingAddressIndex,
    buildingAddress,
    buildingMapFeatures,
    entranceFeatures,
    describePoint,
  } = await import('../../apps/web/src/selection/point-selection.js');
  const fixture = readContractJSON('fixtures/building-entrances.json');
  assert.equal(validateBuildingLabels(fixture.labels, fixture.buildings, {contractsDirectory}), 1);
  const index = buildingAddressIndex(fixture.labels);
  assert.equal(buildingAddress(index.get(0)), fixture.address);
  assert.equal(
    buildingMapFeatures(fixture.labels).features[0].properties.display_number,
    'Zgrada 1, 27-32',
  );
  assert.equal(entranceFeatures(fixture.labels).features.length, 2);
  const point = describePoint(
    { id: 0, layer: { id: 'buildings' } },
    [19.2605, 42.4405],
    index,
  );
  assert.ok(point.facts.addresses.includes(fixture.address));
  assert.deepEqual(
    fs.readFileSync('dist/web/data/building-labels.geojson'),
    fs.readFileSync(dataSourcePath('building-labels.geojson')),
  );
  assert.ok(
    JSON.parse(fs.readFileSync('dist/web/data/manifest.json')).shell.includes(
      'data/building-labels.geojson',
    ),
  );
});

test('the contracts helper uses the repository pin by default and the candidate in a published run', t => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-map-contracts-root-'));
  t.after(() => fs.rmSync(temporaryRoot, {recursive: true, force: true}));
  const helper = path.join(temporaryRoot, 'tests/contracts-root.mjs');
  fs.mkdirSync(path.dirname(helper), {recursive: true});
  fs.copyFileSync(new URL('../contracts-root.mjs', import.meta.url), helper);
  fs.writeFileSync(path.join(temporaryRoot, 'package.json'), JSON.stringify({name: 'repository-manifest'}));

  const writePackage = (parent, version) => {
    const packageRoot = path.join(parent, 'node_modules/@ivanov-gv/map-contracts');
    fs.mkdirSync(packageRoot, {recursive: true});
    fs.writeFileSync(
      path.join(packageRoot, 'package.json'),
      JSON.stringify({name: '@ivanov-gv/map-contracts', version})
    );
  };
  writePackage(temporaryRoot, '0.1.0');
  writePackage(path.join(temporaryRoot, 'tests'), '0.2.0');

  const runHelper = (args, version) => {
    const environment = {...process.env, MAP_CONTRACTS_ROOT: path.join(temporaryRoot, 'contracts')};
    if (version) environment.MAP_CONTRACTS_VERSION = version;
    else delete environment.MAP_CONTRACTS_VERSION;
    return execFileSync(process.execPath, [helper, ...args], {
      cwd: temporaryRoot,
      encoding: 'utf8',
      env: environment
    }).trim();
  };
  const resolvePublishedRoot = version => {
    const script = `import {publishedContractsRoot} from ${JSON.stringify(pathToFileURL(helper).href)}; console.log(publishedContractsRoot());`;
    const environment = {...process.env};
    if (version) environment.MAP_CONTRACTS_VERSION = version;
    else delete environment.MAP_CONTRACTS_VERSION;
    return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: temporaryRoot,
      encoding: 'utf8',
      env: environment
    }).trim();
  };

  assert.equal(
    resolvePublishedRoot(),
    path.join(temporaryRoot, 'node_modules/@ivanov-gv/map-contracts'),
    'a HEAD run must ignore a leftover tests candidate'
  );
  assert.equal(
    resolvePublishedRoot('0.2.0'),
    path.join(temporaryRoot, 'tests/node_modules/@ivanov-gv/map-contracts'),
    'a published run must test the candidate it installed'
  );
  assert.equal(
    runHelper(['--published'], undefined),
    path.join(temporaryRoot, 'tests/node_modules/@ivanov-gv/map-contracts'),
    'the --published flag must select the candidate'
  );
});
