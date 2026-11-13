import test from 'node:test';
import assert from 'node:assert/strict';
import {
  positionActionLabel,
  positionIndicator,
  positionMessage,
  positionStatusText,
  transportStatusText
} from '../src/status-messages.js';

const fix = {coordinates: [19.26, 42.44], accuracy: 12.4, timestamp: 1};

test('transport status counts buses and falls back to unavailable for unknown states', () => {
  const fetchedAt = '2026-10-18T18:00:00Z';
  assert.match(transportStatusText({state: 'live', count: 1, fetchedAt}), /^1 bus position · checked /);
  assert.match(transportStatusText({state: 'live', count: 3, fetchedAt}), /^3 bus positions · checked /);
  assert.match(transportStatusText({state: 'live', count: 0, fetchedAt}), /^No buses reported · checked /);
  assert.equal(transportStatusText({state: 'off', count: 0}), 'Transport off');
  assert.equal(
    transportStatusText({state: 'surprise', count: 0}),
    'Live buses temporarily unavailable · retrying'
  );
});

test('position status names the fallback view only until the person explores or a fix is shown', () => {
  const searching = {state: 'acquiring', fix: null, age: null};
  assert.equal(positionStatusText(searching, false), 'Finding your location… · default view: Podgorica');
  assert.equal(positionStatusText(searching, true), 'Finding your location…');
  assert.equal(positionStatusText({state: 'live', fix, age: 0}, false), 'You are here · ±12 m');
  const outside = {state: 'outside', fix, age: 0};
  assert.equal(
    positionStatusText(outside, false),
    'You are outside the map (Montenegro) · default view: Podgorica'
  );
});

test('position messages, symbols and actions follow the state', () => {
  assert.equal(
    positionMessage({state: 'stale', fix, age: 120_000}),
    'Location not updating · last fix 2 min ago'
  );
  assert.equal(
    positionMessage({state: 'unknown', fix: null, age: null}),
    'Location unavailable · check device settings'
  );
  assert.equal(positionIndicator('live'), '');
  assert.equal(positionIndicator('denied'), '!');
  assert.equal(positionActionLabel('approximate'), 'Follow your location');
  assert.equal(positionActionLabel('stale'), 'Locate me');
  assert.equal(positionActionLabel('live', true), 'Stop following your location');
  assert.equal(positionActionLabel('approximate', true), 'Stop following your location');
  assert.equal(positionActionLabel('stale', true), 'Stop following your location');
});
