import {test, expect} from '@playwright/test';
import {
  CAMERA_HOLD_MILLISECONDS,
  camera,
  closeCard,
  expectCameraToHold,
  expectToHold,
  mapIdle,
  ready,
  settled,
  stubRouting,
  tapMapCenter
} from './helpers.mjs';

const CENTRE = [19.2607, 42.4419];
const ADDRESS = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: CENTRE},
  properties: {
    kind: 'building',
    footprintIndex: 4,
    'addr:housenumber': '18',
    'addr:street': 'Bulevar Stanka Dragojevića'
  }
};
// The uncovered focus zone differs by viewport, so each project places its unique building at that zone's centre.
const FOCUS_COORDINATES = {
  'root-desktop': [19.26266069478649, 42.44174956782041],
  'pages-mobile': [19.26054979629413, 42.44126264012965]
};
const secondAddress = () => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates: FOCUS_COORDINATES[test.info().project.name]},
  properties: {
    kind: 'building',
    footprintIndex: 5,
    'addr:housenumber': '13',
    'addr:street': 'Njegoševa ulica'
  }
});
const PLACE = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.26065, 42.44195]},
  properties: {id: 'node/1', name: 'Bulevar Cafe', category: 'food', kind: 'cafe'}
};
const SECOND_PLACE = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.26085, 42.44205]},
  properties: {id: 'node/2', name: 'Bulevar Market', category: 'food', kind: 'market'}
};
const LOW_LEVEL_MATCH = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.26068, 42.44192]},
  properties: {
    id: 'node/3',
    name: 'Threshold Cafe',
    category: 'food',
    kind: 'cafe',
    visibilityLevel: 1
  }
};
const HIGH_LEVEL_MATCH = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.26095, 42.44208]},
  properties: {
    id: 'node/4',
    name: 'Threshold Market',
    category: 'food',
    kind: 'market',
    visibilityLevel: 5
  }
};
const FAR_ADDRESS = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.8, 42.8]},
  properties: {
    kind: 'building',
    footprintIndex: 6,
    'addr:housenumber': '77',
    'addr:street': 'Planinska ulica'
  }
};
const MANY_ADDRESSES = Array.from({length: 45}, (_, index) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.2607 + index * 0.00002, 42.4419]},
  properties: {
    kind: 'building',
    footprintIndex: 1000 + index,
    'addr:housenumber': '900',
    'addr:street': 'Testna ulica'
  }
}));

const highlightState = page =>
  page.evaluate(() => {
    const map = window.kompasDebug.map;
    return {
      buildings: map.queryRenderedFeatures({layers: ['search-building-outline']}).map(feature => feature.id),
      rings: map
        .queryRenderedFeatures({layers: ['search-place-rings']})
        .map(feature => feature.properties.markerKey),
      buildingFilter: map.getFilter('search-building-outline'),
      buildingColor: map.getPaintProperty('search-building-outline', 'line-color'),
      ringColor: map.getPaintProperty('search-place-rings', 'circle-stroke-color'),
      searchGreen: getComputedStyle(document.documentElement).getPropertyValue('--search-highlight').trim()
    };
  });
// Expands the rendered marker layers to the listing identities used by the result list and the ring comparison.
const renderedPlaceIds = page =>
  page.evaluate(() => {
    const map = window.kompasDebug.map;
    const layers = map
      .getStyle()
      .layers.map(layer => layer.id)
      .filter(id => id.startsWith('place-icons-') || id === 'search-place');
    return [
      ...new Set(map.queryRenderedFeatures({layers}).flatMap(feature => JSON.parse(feature.properties.activeIds)))
    ].sort();
  });
// Mirrors the app's footprint filter contract without relying on the expression's position in the array.
const footprintFilter = footprints => ['in', ['id'], ['literal', footprints]];
const isInView = (page, coordinates) =>
  page.evaluate(point => window.kompasDebug.map.getBounds().contains(point), coordinates);
const detailsLines = page => page.locator('#place-details p.detail').allInnerTexts();

test.use({serviceWorkers: 'block'});

test.beforeEach(async ({page}) => {
  const address = secondAddress();
  await page.addInitScript(() => {
    localStorage.clear();
    // Keep startup's update handle without installing a shell that can re-navigate mid-test.
    Object.defineProperty(navigator.serviceWorker, 'register', {
      configurable: true,
      value: async () => ({update: async () => {}})
    });
  });
  await stubRouting(page);
  await page.route('**/data/building-labels.geojson', route =>
    route.fulfill({
      json: {type: 'FeatureCollection', features: [ADDRESS, address, FAR_ADDRESS, ...MANY_ADDRESSES]}
    })
  );
  await page.route('**/data/places.geojson', route =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [PLACE, SECOND_PLACE, LOW_LEVEL_MATCH, HIGH_LEVEL_MATCH]
      }
    })
  );
  await ready(page);
  await page.evaluate(coordinates => window.kompasDebug.map.jumpTo({center: coordinates, zoom: 17}), CENTRE);
});

test('result rows identify places, buildings and addresses and list the nearest first', async ({page}) => {
  await page.locator('#search').fill('bulevar');
  await expect(page.locator('.result')).toHaveCount(3);
  await expect(page.locator('.result').first()).toHaveAttribute('data-kind', 'address');
  await expect(page.locator('.result').first().locator('.symbol')).toHaveText('📍');
  await expect(page.locator('.result').nth(1)).toHaveAttribute('data-kind', 'place');
  await expect(page.locator('.result').nth(1).locator('.symbol')).toHaveText('C');
  await expect(page.locator('.result').nth(2)).toHaveAttribute('data-kind', 'place');
  await expect(page.locator('.result').nth(2).locator('.symbol')).toHaveText('M');

  await page.locator('#search').fill('13');
  await expect(page.locator('.result')).toHaveCount(1);
  await expect(page.locator('.result')).toHaveAttribute('data-kind', 'building');
  await expect(page.locator('.result').locator('.symbol')).toHaveText('🏢');
  await expect(page.locator('.result').locator('small')).toHaveText('Building');
});

test('visible results get green highlights and the camera stays still', async ({page}) => {
  const before = await camera(page);
  await page.locator('#search').fill('bulevar');
  await expect
    .poll(async () => (await highlightState(page)).buildings)
    .toEqual([4]);
  await expect
    .poll(async () => (await highlightState(page)).rings.sort())
    .toEqual(['node/1', 'node/2']);
  const highlights = await highlightState(page);
  expect(highlights.searchGreen).toBe('#2e7d32');
  expect(highlights.buildingColor).toBe(highlights.searchGreen);
  expect(highlights.ringColor).toBe(highlights.searchGreen);
  await expectCameraToHold(page, before);

  // Moving the view drops highlights for results that are no longer visible; the camera is not pulled back.
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.3, 42.5], zoom: 17}));
  await expect
    .poll(async () => (await highlightState(page)).buildings)
    .toEqual([]);
  await expect
    .poll(async () => (await highlightState(page)).rings)
    .toEqual([]);
  expect(await camera(page)).not.toEqual(before);
});

test('a place below its marker threshold is ringed only once its marker is drawn', async ({page}) => {
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.2607, 42.4419], zoom: 15.8}));
  await mapIdle(page);
  await page.locator('#search').fill('threshold');
  await expect.poll(() => renderedPlaceIds(page)).toEqual(['node/3']);
  await expect.poll(async () => (await highlightState(page)).rings).toEqual(['node/3']);

  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.2607, 42.4419], zoom: 17}));
  await mapIdle(page);
  await expect.poll(() => renderedPlaceIds(page)).toEqual(['node/3', 'node/4']);
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(['node/3', 'node/4']);
});

test('choosing a building result replaces its green outline with the red selection', async ({page}) => {
  await page.locator('#search').fill('bulevar');
  await expect(page.locator('.result[data-kind="address"]')).toHaveCount(1);
  await page.locator('.result[data-kind="address"]').click();
  await expect(page.locator('#place-name')).toHaveText('Building 18');
  await expect(page.locator('#place-details')).toContainText('Bulevar Stanka Dragojevića 18');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.stringify(window.kompasDebug.map.getFilter('selected-buildings-outline')))
    )
    .toBe(JSON.stringify(['==', ['id'], 4]));
  await expect
    .poll(async () => (await highlightState(page)).buildings)
    .toEqual([]);
  // Places' green rings are still there: only the chosen result turned red.
  expect((await highlightState(page)).rings.sort()).toEqual(['node/1', 'node/2']);
});

test('clearing the search removes every green highlight', async ({page}) => {
  await page.locator('#search').fill('bulevar');
  await expect
    .poll(async () => (await highlightState(page)).buildings)
    .toEqual([4]);
  await page.locator('#clear-search').click();
  await expect
    .poll(async () => (await highlightState(page)).buildings)
    .toEqual([]);
  await expect
    .poll(async () => (await highlightState(page)).rings)
    .toEqual([]);

  // The next × closes Open results; it must not bring any green mark back.
  await page.locator('#clear-search').click();
  await expect(page.locator('#search')).toHaveValue('');
  expect(await highlightState(page)).toMatchObject({buildings: [], rings: []});
});

test('closing Open results clears category highlights and keeps the category filter', async ({page}) => {
  await page.locator('#search').fill('bulevar');
  await page.locator('#categories button[data-category="food"]').click();
  await expect(page.locator('.result')).toHaveCount(2);
  await expect
    .poll(async () => (await highlightState(page)).rings.sort())
    .toEqual(['node/1', 'node/2']);

  // Clearing a Filled query keeps the category and its place highlights.
  await page.locator('#clear-search').click();
  await expect(page.locator('#search')).toHaveValue('');
  expect((await highlightState(page)).rings.sort()).toEqual(['node/1', 'node/2']);

  // Closing Open results removes the marks without resetting the category.
  await page.locator('#clear-search').click();
  await expect
    .poll(async () => (await highlightState(page)).rings)
    .toEqual([]);
  await expect(page.locator('#categories button[data-category="food"]')).toHaveAttribute('aria-pressed', 'true');
});

test('the leading place stays green after a pan with no red preview', async ({page}) => {
  await page.locator('#search').fill('bulevar');
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(['node/1', 'node/2']);
  const preview = () =>
    page.evaluate(() =>
      Boolean(window.kompasDebug.map.getFeatureState({source: 'places', id: 'node/1'}).preview)
    );
  // The leading match is only chosen once its row is used; a plain search must never reserve a red preview,
  // including after the debounced filter settles.
  await expectToHold(async () => expect(await preview()).toBe(false), CAMERA_HOLD_MILLISECONDS);
  // Wait for the app's moveend handler, which is where it refreshes highlights after a camera move.
  const moved = page.evaluate(
    () => new Promise(resolve => window.kompasDebug.map.once('moveend', () => resolve(true)))
  );
  await page.evaluate(() => window.kompasDebug.map.panBy([40, -25], {duration: 0}));
  await moved;
  await settled(page);
  await mapIdle(page);
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(['node/1', 'node/2']);
});

test('choosing an off-screen address reveals it and zooms to street level', async ({page}) => {
  const target = FAR_ADDRESS.geometry.coordinates;
  await page.evaluate(center => window.kompasDebug.map.jumpTo({center, zoom: 12}), CENTRE);
  await settled(page);
  const before = await camera(page);
  await page.locator('#search').fill('77');
  await expect(page.locator('.result')).toHaveCount(1);
  await expect.poll(() => isInView(page, target)).toBe(false);
  await page.locator('.result').click();
  await expect.poll(() => isInView(page, target)).toBe(true);
  await settled(page);
  const after = await camera(page);
  expect(after.center).not.toEqual(before.center);
  expect(after.zoom).toBeGreaterThanOrEqual(15);
});

test('an address in the focus zone opens the map-tap card without moving the camera', async ({page}) => {
  await page.locator('#search').fill('13');
  await expect(page.locator('.result')).toHaveCount(1);
  await settled(page);
  await mapIdle(page);
  const before = await camera(page);
  await page.locator('.result').click();
  await expect(page.locator('#place-name')).toHaveText('Building 13');
  await expect(page.locator('#place-details')).toContainText('Njegoševa ulica 13');
  const fromResult = await page.locator('#place-name').innerText();
  const detailsFromResult = await detailsLines(page);
  await expectCameraToHold(page, before);
  await closeCard(page);
  await tapMapCenter(page, secondAddress().geometry.coordinates);
  await expect(page.locator('#place-name')).toHaveText(fromResult);
  expect(await detailsLines(page)).toEqual(detailsFromResult);
});

test('the list order survives a building card', async ({page}) => {
  await page.locator('#search').fill('bulevar');
  await expect(page.locator('.result').first()).toHaveAttribute('data-id', 'footprint/4');
  await page.locator('.result[data-kind="address"]').click();
  await expect(page.locator('#place-name')).toBeVisible();
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.26085, 42.44205], zoom: 17}));
  await settled(page);
  await expect(page.locator('.result').first()).toHaveAttribute('data-id', 'footprint/4');
});

test('green outlines cover every match beyond the 40-row list limit', async ({page}) => {
  await page.locator('#search').fill('900');
  await expect(page.locator('.result')).toHaveCount(40);
  const expected = footprintFilter(MANY_ADDRESSES.map(feature => feature.properties.footprintIndex));
  await expect.poll(async () => (await highlightState(page)).buildingFilter).toEqual(expected);
});

test('an unchanged visible set reuses the highlight source', async ({page}) => {
  await page.locator('#search').fill('13');
  await expect.poll(async () => (await highlightState(page)).buildings).toEqual([5]);
  await mapIdle(page);
  await page.evaluate(() => {
    window.__highlightUpdates = 0;
    window.kompasDebug.map.on('sourcedata', event => {
      if (event.sourceId === 'search-place-highlights' && event.sourceDataType === 'content')
        window.__highlightUpdates += 1;
    });
  });
  await page.evaluate(() => window.kompasDebug.map.panBy([1, 1], {duration: 0}));
  await settled(page);
  await mapIdle(page);
  expect(await page.evaluate(() => window.__highlightUpdates)).toBe(0);
});

test('tapping a highlighted building removes its green fringe', async ({page}) => {
  await page.locator('#search').fill('13');
  await expect.poll(async () => (await highlightState(page)).buildings).toEqual([5]);
  await tapMapCenter(page, secondAddress().geometry.coordinates);
  await expect(page.locator('#place-name')).toBeVisible();
  await expect.poll(async () => (await highlightState(page)).buildings).toEqual([]);
});
