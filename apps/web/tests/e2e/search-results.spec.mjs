import {test, expect} from '@playwright/test';
import {camera, expectCameraToHold, ready, stubRouting} from './helpers.mjs';

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
const SECOND_ADDRESS = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.2613, 42.4417]},
  properties: {
    kind: 'building',
    footprintIndex: 5,
    'addr:housenumber': '13',
    'addr:street': 'Njegoševa ulica'
  }
};
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
      ringColor: map.getPaintProperty('search-place-rings', 'circle-stroke-color')
    };
  });

test.beforeEach(async ({page}) => {
  await stubRouting(page);
  await page.route('**/data/building-labels.geojson', route =>
    route.fulfill({json: {type: 'FeatureCollection', features: [ADDRESS, SECOND_ADDRESS]}})
  );
  await page.route('**/data/places.geojson', route =>
    route.fulfill({json: {type: 'FeatureCollection', features: [PLACE, SECOND_PLACE]}})
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
  expect(highlights.buildingColor).toBe('#2e7d32');
  expect(highlights.ringColor).toBe('#2e7d32');
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

test('choosing a building result replaces its green outline with the red selection', async ({page}) => {
  await page.locator('#search').fill('bulevar');
  await expect(page.locator('.result[data-kind="address"]')).toHaveCount(1);
  await page.locator('.result[data-kind="address"]').click();
  await expect(page.locator('#place-name')).toHaveText('Bulevar Stanka Dragojevića 18');
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
