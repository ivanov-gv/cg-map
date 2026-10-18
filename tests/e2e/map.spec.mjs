import {test, expect} from '@playwright/test';
import fs from 'node:fs';
const fixture = JSON.parse(fs.readFileSync('data/tests/fixtures/podgorica-places.geojson'));
async function ready(page) {
  await page.goto('./');
  await expect(page).not.toHaveURL(/\/web\//);
  await page.waitForFunction(() => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('place-circles'));
  await expect(page.locator('#loading')).toBeHidden();
}

test('map, fixture search, selection, and satellite preserve the map instance', async ({page, isMobile}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
  await ready(page);
  expect(await page.evaluate(() => window.kompasDebug.placeCount)).toBe(fixture.features.length);
  if (isMobile) await page.locator('#toggle-results').click();
  await page.locator('.result').first().click();
  await expect(page.locator('#place-card')).toBeVisible();
  await page.locator('#close-place').click();
  await expect(page.locator('#place-card')).toBeHidden();
  await page.locator('#search').fill(fixture.features[0].properties.name);
  await expect.poll(() => page.locator('.result').count()).toBeGreaterThan(0);
  await page.locator('#reset').click();
  await page.evaluate(() => {window.originalMap = window.kompasDebug.map;});
  await page.getByRole('button', {name: 'Satellite', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.kompasDebug.satellite)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  await page.getByRole('button', {name: 'Street map', exact: true}).click();
  expect(await page.evaluate(() => window.originalMap === window.kompasDebug.map)).toBe(true);
  expect(errors).toEqual([]);
});

test('shipped snapshot downloads and reloads offline with real archive data', async ({page, context}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await expect(page.locator('#download')).toBeEnabled();
  await page.locator('#download').click();
  await page.waitForFunction(() => window.kompasDebug.offline, null, {timeout: 60000});
  await expect(page.locator('#download-state')).toHaveText('READY');
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.kompasDebug?.offline && window.kompasDebug.map.getLayer('place-circles'));
  await expect(page.locator('#loading')).toBeHidden();
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.256, 42.442], zoom: 16}));
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  expect(errors).toEqual([]);
});

test('old /web/ bookmarks open the root app and preserve query/hash', async ({page, baseURL}) => {
  await page.goto(new URL('web/?lang=sr#place', baseURL).href);
  await expect(page).toHaveURL(new URL('?lang=sr#place', baseURL).href);
  await page.waitForFunction(() => window.kompasDebug?.map?.getLayer('place-circles'));
  await expect(page.locator('#loading')).toBeHidden();
});

test('transport toggles, renders route positions, pauses offline, and clears on disable', async ({page, context}) => {
  let calls = 0;
  await page.route('https://cg-map-transit-relay.arcane-pond-2083.chatgpt.site/api/vehicles', route => {
    calls++;
    return route.fulfill({json: {type: 'FeatureCollection', fetchedAt: new Date().toISOString(), stale: false,
      features: [{type: 'Feature', geometry: {type: 'Point', coordinates: [19.26, 42.44]}, properties: {route: '6A'}}]}});
  });
  await ready(page);
  expect(calls).toBe(0);
  const map = await page.evaluateHandle(() => window.kompasDebug.map);
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await expect(page.locator('#transport-status')).toHaveText(/1 bus position · checked/);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getSource('transport')._data.features.length)).toBe(1);
  expect(await page.evaluate(original => original === window.kompasDebug.map, map)).toBe(true);
  await page.getByRole('button', {name: 'Satellite', exact: true}).click();
  await expect(page.locator('#transport-toggle')).toHaveAttribute('aria-pressed', 'true');
  await context.setOffline(true);
  await expect(page.locator('#transport-status')).toHaveText(/internet connection/);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getSource('transport')._data.features.length)).toBe(0);
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await expect(page.locator('#transport-info')).toBeHidden();
});

test('transport failure is visible and does not break the map', async ({page}) => {
  await page.route('https://cg-map-transit-relay.arcane-pond-2083.chatgpt.site/api/vehicles', route => route.fulfill({status: 503, json: {error: 'unavailable'}}));
  await ready(page);
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await expect(page.locator('#transport-status')).toHaveText(/temporarily unavailable/);
  expect(await page.evaluate(() => !!window.kompasDebug.map.getLayer('place-circles'))).toBe(true);
});
