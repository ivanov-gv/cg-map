import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  cardStateAfterSwipe,
  isInFocusZone,
  searchBounds,
  uncoveredMapArea,
  uncoveredMapOffset
} from '../src/interface.js';
import {
  DESKTOP_MEDIA_QUERY,
  deviceClass,
  FLIP_MEDIA_QUERY,
  MOBILE_MEDIA_QUERY
} from '../src/device-class.js';

test('search bubble stays within half the visible viewport, including keyboard and scroll offsets', () => {
  for (const height of [840, 500, 420, 240, 100]) {
    const bounds = searchBounds({height, top: 25});
    assert.equal(bounds.top, 107);
    assert.ok(bounds.maxHeight <= height / 2);
    assert.ok(bounds.maxHeight >= 0);
    if (height >= 164) assert.equal(bounds.top + bounds.maxHeight, 25 + height / 2);
  }
});

test('search bounds uses barHeight to position the bubble', () => {
  // Default barHeight is 54; with inset 12 and gapBelowBar 16, headerBottom = 82.
  const defaultBounds = searchBounds({height: 840, top: 0});
  assert.equal(defaultBounds.top, 82);
  // Mobile bar is 44 px tall; headerBottom = 12 + 44 + 16 = 72.
  const mobileBounds = searchBounds({height: 840, top: 0, barHeight: 44});
  assert.equal(mobileBounds.top, 72);
  // Desktop bar is 60 px tall; headerBottom = 12 + 60 + 16 = 88.
  const desktopBounds = searchBounds({height: 840, top: 0, barHeight: 60});
  assert.equal(desktopBounds.top, 88);
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
  function fakeMatchMedia(width, height) {
    return (query) => {
      // Parse simple media queries: (max-width: Npx) and (max-height: Npx) or (max-width: Npx)
      const maxWidthMatch = query.match(/\(max-width:\s*(\d+)px\)/);
      const maxHeightMatch = query.match(/\(max-height:\s*(\d+)px\)/);
      const matchesWidth = !maxWidthMatch || width <= Number(maxWidthMatch[1]);
      const matchesHeight = !maxHeightMatch || height <= Number(maxHeightMatch[1]);
      return {matches: matchesWidth && matchesHeight};
    };
  }

  // Flip cover screens: small and nearly square (Galaxy Z Flip ~340-380 per side)
  assert.equal(deviceClass(fakeMatchMedia(340, 340)), 'flip');
  assert.equal(deviceClass(fakeMatchMedia(380, 380)), 'flip');
  assert.equal(deviceClass(fakeMatchMedia(400, 400)), 'flip');
  assert.equal(deviceClass(fakeMatchMedia(350, 390)), 'flip');

  // Phones in portrait: width ≤ 720, height > 400 → mobile
  assert.equal(deviceClass(fakeMatchMedia(360, 640)), 'mobile');
  assert.equal(deviceClass(fakeMatchMedia(412, 840)), 'mobile');

  // Edge: width ≤ 720 but height > 400 → mobile, not flip
  assert.equal(deviceClass(fakeMatchMedia(400, 401)), 'mobile');
  assert.equal(deviceClass(fakeMatchMedia(401, 400)), 'mobile');
  assert.equal(deviceClass(fakeMatchMedia(720, 800)), 'mobile');

  // Desktop: width > 720 (includes phones in landscape, e.g. 840×412)
  assert.equal(deviceClass(fakeMatchMedia(721, 480)), 'desktop');
  assert.equal(deviceClass(fakeMatchMedia(840, 412)), 'desktop');
  assert.equal(deviceClass(fakeMatchMedia(1280, 800)), 'desktop');
  assert.equal(deviceClass(fakeMatchMedia(1920, 1080)), 'desktop');
});

test('desktop and mobile queries are complements', () => {
  const desktopMatch = DESKTOP_MEDIA_QUERY.match(/min-width:\s*(\d+)px/);
  const mobileMatch = MOBILE_MEDIA_QUERY.match(/max-width:\s*(\d+)px/);
  assert.ok(desktopMatch, 'DESKTOP_MEDIA_QUERY should contain min-width');
  assert.ok(mobileMatch, 'MOBILE_MEDIA_QUERY should contain max-width');
  const desktopMin = Number(desktopMatch[1]);
  const mobileMax = Number(mobileMatch[1]);
  assert.equal(desktopMin, mobileMax + 1, 'Desktop min-width should be mobile max-width + 1');
});

test('style.css @media conditions match the exported device-class queries', () => {
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

  // Strip comments so the regex only sees real rules.
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Find all @media conditions in the CSS (excluding prefers-* queries).
  const mediaPattern = /@media\s+([^{]+)\{/g;
  const deviceQueries = [FLIP_MEDIA_QUERY, MOBILE_MEDIA_QUERY, DESKTOP_MEDIA_QUERY];
  let match;
  while ((match = mediaPattern.exec(cssWithoutComments)) !== null) {
    const condition = match[1].trim();
    // Skip prefers-* media queries (e.g. prefers-reduced-motion, prefers-color-scheme)
    if (condition.includes('prefers-')) continue;
    const isKnownQuery = deviceQueries.some(query => condition === query);
    assert.ok(isKnownQuery, `style.css @media condition "${condition}" does not match any exported device-class query`);
  }
});
