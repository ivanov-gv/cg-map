import {test, expect} from '@playwright/test';

test('workspace keeps the map and layer when its available space changes', {tag: '@phone'}, async ({page}) => {
  await page.setViewportSize({width: 360, height: 740});
  await page.goto('./');
  await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
  const map = page.locator('#map');
  await expect(map).toHaveCSS('height', '740px');
  const changes = page.getByRole('button', {name: 'Changes', exact: true});
  expect(await changes.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(740);

  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await page.locator('[data-mode="places.geojson"]').click();
  await expect(page.locator('#current-layer')).toHaveText('POIs');
  await expect(page.locator('#status')).toContainText('source features');
  const initialView = await page.evaluate(() => ({
    center: window.editorDebug.map.getCenter().toArray(),
    zoom: window.editorDebug.map.getZoom()
  }));
  await page.setViewportSize({width: 900, height: 500});
  await expect(page.locator('#current-layer')).toHaveText('POIs');
  expect(await page.evaluate(() => ({
    center: window.editorDebug.map.getCenter().toArray(),
    zoom: window.editorDebug.map.getZoom()
  }))).toEqual(initialView);
  await expect(page.locator('#map')).toHaveCSS('height', '500px');
  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await expect(page.locator('#layers-panel').getByRole('link', {name: 'OpenStreetMap contributors'})).toBeVisible();
});
