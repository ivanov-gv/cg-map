import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {dataSourcePath, dataToolURL} from '../data-root.mjs';

const {reversedCanyonRims, reversedClosedContours} = await import(dataToolURL('relief-directions.mjs'));
const source = name => JSON.parse(fs.readFileSync(dataSourcePath(name), 'utf8'));

// map-core offsets canyon walls toward the river and keeps contour heights un-flipped, trusting these directions.
test('the published relief keeps the directions map-core draws by', () => {
  assert.deepEqual(reversedCanyonRims(source('canyon-rims.geojson'), source('water.geojson')), []);
  const contours = reversedClosedContours(source('contours.geojson'), source('summits.geojson'));
  assert.ok(contours.judgedCount > 0);
  assert.deepEqual(contours.reversed, []);
});
