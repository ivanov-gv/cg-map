import test from 'node:test';
import assert from 'node:assert/strict';
import fileSystem from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {copyMapData} from '../tools/app-data.mjs';
import {writeEditorBundle} from '../tools/editor-bundle.mjs';

function temporaryDirectory(t) {
  const directory = fileSystem.mkdtempSync(path.join(os.tmpdir(), 'map-data-tools-'));
  t.after(() => fileSystem.rmSync(directory, {recursive: true, force: true}));
  return directory;
}

test('copyMapData reads an injected root and contract', t => {
  const directory = temporaryDirectory(t);
  const dataRoot = path.join(directory, 'data');
  const outputDirectory = path.join(directory, 'artifact');
  const archive = 'montenegro-0123456789abcdef.pmtiles';
  const archiveBytes = Buffer.from('reviewed archive bytes');
  const digest = createHash('sha256').update(archiveBytes).digest('hex');
  const places = '{"type":"FeatureCollection","features":[]}';

  for (const subdirectory of ['artifacts', 'sources', 'imagery/podgorica']) {
    fileSystem.mkdirSync(path.join(dataRoot, subdirectory), {recursive: true});
  }
  fileSystem.writeFileSync(
    path.join(dataRoot, 'artifacts/release.json'),
    JSON.stringify({archive: {file: archive, bytes: archiveBytes.length, sha256: digest}})
  );
  fileSystem.writeFileSync(path.join(dataRoot, 'artifacts', archive), archiveBytes);
  fileSystem.writeFileSync(path.join(dataRoot, 'sources/places.geojson'), places);
  fileSystem.writeFileSync(path.join(dataRoot, 'sources/building-labels.geojson'), places);
  fileSystem.writeFileSync(path.join(dataRoot, 'imagery/podgorica/manifest.json'), '{}');
  const contractPath = path.join(directory, 'place-visibility.json');
  fileSystem.writeFileSync(contractPath, '{"injected":true}');

  copyMapData(outputDirectory, {dataRoot, contractPath});

  assert.equal(fileSystem.readFileSync(path.join(outputDirectory, 'data/map.json'), 'utf8'), JSON.stringify({archive}));
  assert.deepEqual(JSON.parse(fileSystem.readFileSync(path.join(outputDirectory, 'data/place-visibility.json'), 'utf8')), {
    injected: true
  });
  assert.equal(fileSystem.readFileSync(path.join(outputDirectory, 'data/places.geojson'), 'utf8'), places);
  assert.equal(fileSystem.readFileSync(path.join(outputDirectory, 'data', archive)).toString(), archiveBytes.toString());
});

test('writeEditorBundle reads an injected source directory and contract', async t => {
  const directory = temporaryDirectory(t);
  const contractURL = new URL('../../packages/contracts/editor-bundle.schema.json', import.meta.url);
  const contract = JSON.parse(fileSystem.readFileSync(contractURL, 'utf8'));
  const filenames = contract.properties.layers.items.properties.filename.enum;
  const sourceDirectory = path.join(directory, 'sources');
  fileSystem.mkdirSync(sourceDirectory);
  for (const filename of filenames) {
    fileSystem.writeFileSync(path.join(sourceDirectory, filename), '{"type":"FeatureCollection","features":[]}');
  }

  const outputDirectory = path.join(directory, 'bundle');
  const manifest = await writeEditorBundle(sourceDirectory, outputDirectory, contractURL);

  assert.deepEqual(
    manifest.layers.map(layer => layer.filename),
    filenames
  );
  assert.deepEqual(fileSystem.readdirSync(outputDirectory).sort(), [...filenames, 'manifest.json'].sort());
});
