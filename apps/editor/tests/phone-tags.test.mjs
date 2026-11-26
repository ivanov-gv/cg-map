import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {untaggedPhoneTests} from '../../../platform/tools/phone-tags.mjs';

// Each helper only chooses how to press something on each layout, so its test checks the same behavior on both.
const NEUTRAL_HELPERS = new Set(['closeCard']);

test('a phone-dependent editor test is tagged, or a PR would not run it there', () => {
  const filesUnder = (directory, suffix) =>
    fs.readdirSync(directory, {withFileTypes: true}).flatMap(entry => {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return filesUnder(filePath, suffix);
      return entry.name.endsWith(suffix) ? [{filePath, text: fs.readFileSync(filePath, 'utf8')}] : [];
    });
  const testDirectory = path.resolve(import.meta.dirname, 'e2e');
  const journeyDirectory = path.resolve(import.meta.dirname, '../e2e');
  const sourceDirectory = path.resolve(import.meta.dirname, '../src');
  const helpers = filesUnder(testDirectory, '.mjs')
    .filter(({filePath}) => !filePath.endsWith('.spec.mjs'))
    .map(({text}) => text);
  const specs = [
    ...filesUnder(testDirectory, '.spec.mjs'),
    ...filesUnder(journeyDirectory, '.spec.js'),
    ...filesUnder(sourceDirectory, '.browser.test.js')
  ];
  for (const {filePath, text} of specs) {
    assert.deepEqual(untaggedPhoneTests(text, helpers, NEUTRAL_HELPERS), [], filePath);
  }
});

// Platform tests the workflow inputs; the editor tests that its own config reads the mode those inputs supply.
test('the browser config applies the phone mode from CI', () => {
  const config = fs.readFileSync(new URL('../playwright.config.mjs', import.meta.url), 'utf8');
  assert.match(config, /process\.env\.E2E_PHONE === 'tagged' \? \{grep: \/@phone\/\}/);
});
