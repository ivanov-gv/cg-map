import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';

const contractsDirectory = new URL('../', import.meta.url);
const readJSON = relativePath => JSON.parse(readFileSync(new URL(relativePath, contractsDirectory)));
const jsonFiles = readdirSync(contractsDirectory).filter(filename => filename.endsWith('.json'));

// Producers and consumers test their own use of these files; this project only guards the files themselves.
test('every published schema declares its dialect, title and shape', () => {
  const schemaFiles = jsonFiles.filter(filename => filename.endsWith('.schema.json'));
  assert.ok(schemaFiles.length > 0);
  for (const filename of schemaFiles) {
    const schema = readJSON(filename);
    assert.ok(schema.$schema, `${filename} needs $schema`);
    assert.ok(schema.title, `${filename} needs a title`);
    assert.ok(schema.type || schema.properties, `${filename} needs a shape`);
  }
});

test('the level table has consecutive levels with increasing zooms and an admitted fallback', () => {
  const {levels, legacyFallbackLevel} = readJSON('place-visibility.json');
  levels.forEach((entry, index) => {
    assert.equal(entry.level, index + 1);
    if (index > 0) assert.ok(entry.minZoom > levels[index - 1].minZoom);
  });
  assert.ok(levels.some(entry => entry.level === legacyFallbackLevel));
});

test('shared fixtures are valid JSON', () => {
  for (const filename of readdirSync(new URL('fixtures/', contractsDirectory))) {
    assert.doesNotThrow(() => readJSON(`fixtures/${filename}`), filename);
  }
});
