import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {untaggedPhoneTests} from '../../../platform/tools/phone-tags.mjs';

// Each helper only chooses how to press something on each layout, so its test checks the same behavior on both.
const NEUTRAL_HELPERS = new Set(['closeCard']);

test('a phone-dependent editor test is tagged, or a PR would not run it there', () => {
  const directory = path.resolve(import.meta.dirname, 'e2e');
  const names = fs.readdirSync(directory);
  const read = name => fs.readFileSync(path.join(directory, name), 'utf8');
  const helpers = names.filter(name => name.endsWith('.mjs') && !name.endsWith('.spec.mjs')).map(read);
  for (const spec of names.filter(name => name.endsWith('.spec.mjs'))) {
    assert.deepEqual(untaggedPhoneTests(read(spec), helpers, NEUTRAL_HELPERS), [], spec);
  }
});
