import test from 'node:test';
import assert from 'node:assert/strict';
import {searchBounds, uncoveredMapOffset} from '../src/interface.js';

test('search bubble stays within half the visible viewport, including keyboard and scroll offsets', () => {
  for (const height of [840, 500, 420, 240, 100]) {
    const bounds = searchBounds({height, top: 25});
    assert.equal(bounds.top, 107);
    assert.ok(bounds.maxHeight <= height / 2);
    assert.ok(bounds.maxHeight >= 0);
    if (height >= 164) assert.equal(bounds.top + bounds.maxHeight, 25 + height / 2);
  }
});

test('search target stays below bubble and above keyboard without changing the map container', () => {
  for (const visibleHeight of [840, 420]) {
    const bounds = searchBounds({height: visibleHeight, top: 25});
    const searchBottom = bounds.top + bounds.maxHeight;
    const offset = uncoveredMapOffset({width: 412, height: 840, visibleTop: 25, visibleHeight, headerBottom: 91, searchBottom, mobile: true});
    const point = [206 + offset[0], 420 + offset[1]];
    assert.ok(point[0] > 16 && point[0] < 340);
    assert.ok(point[1] > searchBottom);
    assert.ok(point[1] < visibleHeight + 25 - 20);
  }
});

test('selected point stays above phone details and beside desktop details or dock', () => {
  const phone = uncoveredMapOffset({width: 412, height: 840, headerBottom: 66, details: {top: 480, right: 340}, mobile: true});
  assert.ok(420 + phone[1] > 82 && 420 + phone[1] < 464);
  const desktop = uncoveredMapOffset({width: 1280, height: 800, headerBottom: 74, dockRight: 400, details: {top: 94, right: 395}});
  assert.ok(640 + desktop[0] > 416 && 640 + desktop[0] < 1208);
});
