import {test, expect} from '@playwright/test';
import fs from 'node:fs';
const fixture = JSON.parse(fs.readFileSync('tests/fixtures/podgorica-places.geojson'));
async function ready(page) {
  await page.goto('./');
  await expect(page).toHaveURL(/\/web\/$/);
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
