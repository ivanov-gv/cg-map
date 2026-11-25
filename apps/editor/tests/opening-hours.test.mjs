import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatOpeningHours,
  openingHoursPresets,
  openingHoursProblem,
  parseOpeningHours
} from '../src/opening-hours.js';

for (const text of [
  '24/7',
  'Mo-Su 08:00-20:00',
  'Mo-Fr 08:00-23:00; Sa,Su,PH 10:00-22:00',
  'Mo-Fr 08:00-14:00,16:00-20:00; Sa 09:00-13:00; Su,PH off'
]) {
  test(`opening hours round trip: ${text}`, () => {
    const expected = text.replace('Sa,Su,PH', 'Sa-Su,PH');
    assert.equal(formatOpeningHours(parseOpeningHours(text)), expected);
  });
}

test('days may wrap around the week, and times gain their leading zero', () => {
  assert.equal(formatOpeningHours(parseOpeningHours('Sa-Mo 9:00-17:00')), 'Mo,Sa-Su 09:00-17:00');
  assert.equal(formatOpeningHours(parseOpeningHours('09:00-17:00')), 'Mo-Su 09:00-17:00');
});

for (const text of ['Mo-Fr sunrise-sunset', 'Jan-Mar Mo 08:00-12:00', 'by appointment', 'PH-Mo 08:00-12:00', '']) {
  test(`text the editor cannot show stays text: "${text}"`, () => assert.equal(parseOpeningHours(text), null));
}

test('a model that cannot be stored says why', () => {
  const model = groups => ({isAlwaysOpen: false, groups});
  assert.match(openingHoursProblem(model([])), /at least one day/);
  const monday = {days: ['Mo'], intervals: [{from: '08:00', to: '12:00'}]};
  assert.match(openingHoursProblem(model([monday, monday])), /two groups/);
  assert.match(openingHoursProblem(model([{days: ['Mo'], intervals: [{from: '8', to: '12:00'}]}])), /08:00/);
  assert.match(openingHoursProblem(model([{days: ['Mo'], intervals: [{from: '08:00', to: '08:00'}]}])), /the same/);
  for (const preset of openingHoursPresets) assert.equal(openingHoursProblem(preset.model), null);
});
