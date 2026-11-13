import {test, expect} from '@playwright/test';
import {openMenu, ready, stubRouting, withFlipViewport} from './helpers.mjs';

test.beforeEach(({page}) => stubRouting(page));

// The floating MapLibre attribution control must not appear on the map surface.
// This is checked for Desktop, Mobile, and Flip viewports.
test('no floating attribution control on the map (desktop)', async ({page}) => {
  await ready(page);
  await expect(page.locator('.maplibregl-ctrl-attrib')).not.toBeVisible();
  // Also verify the element does not exist in the DOM.
  const exists = await page.locator('.maplibregl-ctrl-attrib').count();
  expect(exists).toBe(0);
});

test('no floating attribution control on the map (mobile)', {tag: '@phone'}, async ({page}) => {
  await ready(page);
  const exists = await page.locator('.maplibregl-ctrl-attrib').count();
  expect(exists).toBe(0);
});

test('no floating attribution control on the map (flip)', {tag: '@phone'}, async ({page}) => {
  await withFlipViewport(page, async () => {
    await ready(page);
    const exists = await page.locator('.maplibregl-ctrl-attrib').count();
    expect(exists).toBe(0);
  });
});

// The dock footer must show attribution with a link to the OSM copyright page.
// The test opens the menu (which reveals the dock footer) and checks the content.
test('dock footer shows OSM attribution link (desktop)', async ({page}) => {
  await ready(page);
  await openMenu(page);
  const attribution = page.locator('#map-attribution');
  await expect(attribution).toBeVisible();
  // Check it contains a link to the OSM copyright page.
  const osmLink = attribution.locator('a[href="https://www.openstreetmap.org/copyright"]');
  await expect(osmLink).toBeVisible();
  await expect(osmLink).toContainText('OpenStreetMap contributors');
});

test('dock footer shows OSM attribution link (mobile)', {tag: '@phone'}, async ({page}) => {
  await ready(page);
  await openMenu(page);
  const attribution = page.locator('#map-attribution');
  await expect(attribution).toBeVisible();
  const osmLink = attribution.locator('a[href="https://www.openstreetmap.org/copyright"]');
  await expect(osmLink).toBeVisible();
});

test('dock footer shows OSM attribution link (flip)', {tag: '@phone'}, async ({page}) => {
  await withFlipViewport(page, async () => {
    await ready(page);
    await openMenu(page);
    const attribution = page.locator('#map-attribution');
    await expect(attribution).toBeVisible();
    const osmLink = attribution.locator('a[href="https://www.openstreetmap.org/copyright"]');
    await expect(osmLink).toBeVisible();
  });
});

// When satellite is toggled on, the attribution should include the eMapa credit.
test('attribution includes eMapa when satellite is visible', async ({page}) => {
  await ready(page);
  await openMenu(page);
  // Toggle satellite on.
  await page.getByRole('button', {name: 'Satellite', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.kompasDebug.satellite)).toBe(true);
  const attribution = page.locator('#map-attribution');
  const emapaLink = attribution.locator('a[href="https://emapa.me/"]');
  await expect(emapaLink).toBeVisible();
  await expect(emapaLink).toContainText('eMapa');
});

// When satellite is toggled off, the eMapa credit should disappear.
test('attribution removes eMapa when satellite is hidden', async ({page}) => {
  await ready(page);
  await openMenu(page);
  // Toggle satellite on, then off.
  await page.getByRole('button', {name: 'Satellite', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.kompasDebug.satellite)).toBe(true);
  await page.getByRole('button', {name: 'Satellite', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.kompasDebug.satellite)).toBe(false);
  const attribution = page.locator('#map-attribution');
  const emapaLink = attribution.locator('a[href="https://emapa.me/"]');
  await expect(emapaLink).not.toBeVisible();
});
