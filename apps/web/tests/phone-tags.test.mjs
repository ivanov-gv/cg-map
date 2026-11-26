import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {untaggedPhoneTests} from '../../../platform/tools/phone-tags.mjs';

// Each helper only chooses how to press something on each layout, so its test checks the same behavior on both.
const NEUTRAL_HELPERS = new Set(['closeCard']);

test('a phone-dependent web test is tagged, or a PR would not run it there', () => {
  const directory = path.resolve(import.meta.dirname, 'e2e');
  const names = fs.readdirSync(directory);
  const read = name => fs.readFileSync(path.join(directory, name), 'utf8');
  const helpers = names.filter(name => name.endsWith('.mjs') && !name.endsWith('.spec.mjs')).map(read);
  for (const spec of names.filter(name => name.endsWith('.spec.mjs'))) {
    assert.deepEqual(untaggedPhoneTests(read(spec), helpers, NEUTRAL_HELPERS), [], spec);
  }
});

// Platform tests the workflow inputs; the web app tests that its phone project keeps the tagged default of both runs.
test('the web phone project runs only tagged phone tests', () => {
  const config = fs.readFileSync(new URL('../playwright.config.mjs', import.meta.url), 'utf8');
  assert.match(config, /const phoneFilter = \{grep: \/@phone\/, grepInvert: \/@desktop\/\}/);
  assert.match(config, /name: 'pages-mobile',\n\s*\.\.\.phoneFilter,/);
});
