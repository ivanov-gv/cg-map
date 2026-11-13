import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cardStateAfterSwipe,
  getDeviceClass,
  isInFocusZone,
  searchBounds,
  uncoveredMapArea,
  uncoveredMapOffset
} from '../src/interface.js';

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
    const offset = uncoveredMapOffset({
      width: 412,
      height: 840,
      visibleTop: 25,
      visibleHeight,
      headerBottom: 91,
      searchBottom,
      mobile: true
    });
    const point = [206 + offset[0], 420 + offset[1]];
    assert.ok(point[0] > 16 && point[0] < 340);
    assert.ok(point[1] > searchBottom);
    assert.ok(point[1] < visibleHeight + 25 - 20);
  }
});

test('selected point stays above phone details and beside desktop details or dock', () => {
  const phone = uncoveredMapOffset({
    width: 412,
    height: 840,
    headerBottom: 66,
    details: {top: 480, right: 340},
    mobile: true
  });
  assert.ok(420 + phone[1] > 82 && 420 + phone[1] < 464);
  const desktop = uncoveredMapOffset({
    width: 1280,
    height: 800,
    headerBottom: 74,
    dockRight: 400,
    details: {top: 94, right: 395}
  });
  assert.ok(640 + desktop[0] > 416 && 640 + desktop[0] < 1208);
});

test('focus zone is the inner 75% of the uncovered map width and height', () => {
  const area = {left: 100, right: 500, top: 200, bottom: 600};
  const inside = [
    {x: 300, y: 400},
    {x: 150, y: 250},
    {x: 450, y: 550}
  ];
  const outside = [
    {x: 149, y: 400},
    {x: 451, y: 400},
    {x: 300, y: 249},
    {x: 300, y: 551}
  ];
  for (const point of inside) assert.equal(isInFocusZone(point, area), true, JSON.stringify(point));
  for (const point of outside) assert.equal(isInFocusZone(point, area), false, JSON.stringify(point));
});

test('a place under a panel is never inside the focus zone', () => {
  const phone = uncoveredMapArea({
    width: 412,
    height: 840,
    headerBottom: 66,
    searchBottom: 420,
    details: {top: 742, right: 340},
    mobile: true
  });
  assert.equal(isInFocusZone({x: 178, y: 300}, phone), false, 'under the results');
  assert.equal(isInFocusZone({x: 178, y: 790}, phone), false, 'under the card');
  assert.equal(isInFocusZone({x: 178, y: 580}, phone), true);
  const desktop = uncoveredMapArea({
    width: 1280,
    height: 800,
    headerBottom: 74,
    dockRight: 400,
    details: {top: 20, right: 787}
  });
  assert.equal(isInFocusZone({x: 200, y: 400}, desktop), false, 'under the dock');
  assert.equal(isInFocusZone({x: 600, y: 400}, desktop), false, 'under the card');
  assert.equal(isInFocusZone({x: 1000, y: 400}, desktop), true);
});

test('swiping steps the phone card through full, peek, and closed', () => {
  const cases = [
    {state: 'peek', direction: 'up', resultsBehind: true, next: 'full'},
    {state: 'full', direction: 'down', resultsBehind: true, next: 'peek'},
    {state: 'peek', direction: 'down', resultsBehind: true, next: 'closed'},
    {state: 'full', direction: 'down', resultsBehind: false, next: 'closed'}
  ];
  for (const {next, ...swipe} of cases) assert.equal(cardStateAfterSwipe(swipe), next, JSON.stringify(swipe));
});

test('device class distinguishes flip, mobile, and desktop by viewport size', () => {
  // Flip cover screens: small and nearly square (Galaxy Z Flip ~340-380 per side)
  assert.equal(getDeviceClass(340, 340), 'flip');
  assert.equal(getDeviceClass(380, 380), 'flip');
  assert.equal(getDeviceClass(400, 400), 'flip');
  assert.equal(getDeviceClass(350, 390), 'flip');

  // Phones in portrait: width ≤ 720, height > 400 → mobile
  assert.equal(getDeviceClass(360, 640), 'mobile');
  assert.equal(getDeviceClass(412, 840), 'mobile');

  // Edge: width ≤ 720 but height > 400 → mobile, not flip
  assert.equal(getDeviceClass(400, 401), 'mobile');
  assert.equal(getDeviceClass(401, 400), 'mobile');
  assert.equal(getDeviceClass(720, 800), 'mobile');

  // Desktop: width > 720 (includes phones in landscape, e.g. 840×412)
  assert.equal(getDeviceClass(721, 480), 'desktop');
  assert.equal(getDeviceClass(840, 412), 'desktop');
  assert.equal(getDeviceClass(1280, 800), 'desktop');
  assert.equal(getDeviceClass(1920, 1080), 'desktop');
});
