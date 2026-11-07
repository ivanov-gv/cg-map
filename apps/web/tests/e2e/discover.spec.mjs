import {test, expect} from '@playwright/test';
import {ready, renderedPlaceIcons, stubRouting} from './helpers.mjs';

test.beforeEach(({page}) => stubRouting(page));

test.describe('Discover first view', () => {
  test.use({
    permissions: ['geolocation'],
    geolocation: {latitude: 42.4411, longitude: 19.2627, accuracy: 18}
  });
  test('granted location shows marker, accuracy and status and centers once without a click', async ({
    page
  }) => {
    await ready(page);
    await expect(page.locator('#position-status')).toHaveText(/You are here · ±18 m/);
    await expect
      .poll(() =>
        page.evaluate(() =>
          window.kompasDebug.map.getSource('position')._data.features.map(feature => feature.properties.part)
        )
      )
      .toEqual(['accuracy', 'position']);
    await expect
      .poll(() =>
        page.evaluate(() => window.kompasDebug.map.getCenter().distanceTo({lng: 19.2627, lat: 42.4411}))
      )
      .toBeLessThan(5);
    await expect(page.locator('#position-action')).toHaveAttribute('aria-label', /Recenter on your location/);
    await expect(page.locator('#position-action')).toBeVisible();
    // The location is never written to browser storage.
    expect(
      await page.evaluate(() => JSON.stringify({...localStorage}) + JSON.stringify({...sessionStorage}))
    ).not.toContain('42.441');
    await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.25, 42.43], zoom: 16}));
    await page.locator('#position-action').click();
    await expect(page.locator('#place-card')).toBeHidden();
    await expect
      .poll(() =>
        page.evaluate(() => window.kompasDebug.map.getCenter().distanceTo({lng: 19.2627, lat: 42.4411}))
      )
      .toBeLessThan(150);
  });
});

test('without location the status says so and the default view is labelled as a fallback', async ({page}) => {
  await ready(page);
  await expect(page.locator('#position-status')).toHaveText(
    /(blocked|Allow location|Finding).*default view: Podgorica/
  );
  expect(await page.evaluate(() => window.kompasDebug.map.getSource('position')._data.features.length)).toBe(
    0
  );
});

test('first view is at street scale with minimal controls, house numbers and no Plan prompt', async ({
  page
}) => {
  await ready(page);
  const scaleMetresPerPixel = await page.evaluate(() => {
    const map = window.kompasDebug.map;
    const coordinates = map.getContainer();
    return (
      map
        .unproject([coordinates.clientWidth / 2 - 50, coordinates.clientHeight / 2])
        .distanceTo(map.unproject([coordinates.clientWidth / 2 + 50, coordinates.clientHeight / 2])) / 100
    );
  });
  expect(scaleMetresPerPixel).toBeGreaterThan(0.8);
  expect(scaleMetresPerPixel).toBeLessThan(1.2);
  await expect(page.locator('#dock-content')).toBeHidden();
  await expect(page.locator('#search-bubble')).toBeHidden();
  await expect(page.locator('#menu-toggle')).toBeVisible();
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#position-action')).toBeVisible();
  await expect(page.locator('#map-key, #overview, #podgorica, .intro, .map-note')).toHaveCount(0);
  await expect(page.locator('#position-status')).toHaveClass('sr-only');
  await expect
    .poll(() =>
      page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['building-numbers']}).length)
    )
    .toBeGreaterThan(0);
});

test('country scale draws no ordinary places or count clusters; street scale brings them back', async ({
  page
}) => {
  await ready(page);
  await page.evaluate(() =>
    window.kompasDebug.map.fitBounds(
      [
        [18.42, 41.84],
        [20.36, 43.57]
      ],
      {padding: 55, duration: 0}
    )
  );
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getZoom())).toBeLessThan(9);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  expect(await renderedPlaceIcons(page)).toEqual([]);
  expect(
    await page.evaluate(() => window.kompasDebug.map.getStyle().layers.some(layer => layer.id === 'clusters'))
  ).toBe(false);
  // District scale: only the earliest levels, whose categories are sights and essentials in the published policy.
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.2627, 42.4411], zoom: 14.5}));
  await expect.poll(async () => (await renderedPlaceIcons(page)).length).toBeGreaterThan(0);
  const district = await renderedPlaceIcons(page);
  expect(district.every(icon => icon.level <= 2 && ['sights', 'essentials'].includes(icon.category))).toBe(
    true
  );
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.2627, 42.4411], zoom: 16}));
  await expect
    .poll(async () =>
      (await renderedPlaceIcons(page)).some(icon => ['food', 'shops'].includes(icon.category))
    )
    .toBe(true);
  // The directory is unchanged by scale suppression.
  expect(await page.evaluate(() => window.kompasDebug.placeCount)).toBeGreaterThan(1000);
});

test('footways, steps and cycleways have their own layers', async ({page}) => {
  await ready(page);
  const ids = await page.evaluate(() => window.kompasDebug.map.getStyle().layers.map(layer => layer.id));
  for (const id of ['footways', 'paths', 'cycleways', 'steps']) expect(ids).toContain(id);
});
