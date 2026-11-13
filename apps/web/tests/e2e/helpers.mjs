// Shared by the browser specs. Each spec covers one area, which CI runs as its own job.
import {expect} from '@playwright/test';
import fileSystem from 'node:fs';

const HOLD_CHECK_MILLISECONDS = 50;
// Longer than the selection camera's animation, so a move that should not start has had its chance.
export const CAMERA_HOLD_MILLISECONDS = 600;

// No test may reach the real routing provider.
export const stubRouting = (page) =>
  page.route('https://routing.openstreetmap.de/**', (route) =>
    route.fulfill({status: 503, json: {code: 'Unavailable'}})
  );

export const fixture = JSON.parse(
  fileSystem.readFileSync(
    new URL('../../../../data/tests/fixtures/podgorica-places.geojson', import.meta.url)
  )
);
// Read every rendered place icon, retaining its listing identity and visibility level.
export const renderedPlaceIcons = (page) =>
  page.evaluate(() => {
    const map = window.kompasDebug.map;
    const layers = map
      .getStyle()
      .layers.map((layer) => layer.id)
      .filter((id) => id.startsWith('place-icons-'));
    return map.queryRenderedFeatures({layers}).map((feature) => ({
      id: feature.id,
      category: feature.properties.category,
      level: feature.properties.visibilityLevel
    }));
  });
export async function openMenu(page) {
  if ((await page.locator('#menu-toggle').getAttribute('aria-expanded')) !== 'true')
    await page.locator('#menu-toggle').click();
}
export async function closeMenu(page) {
  if ((await page.locator('#menu-toggle').getAttribute('aria-expanded')) === 'true')
    await page.locator('#menu-toggle').click();
  else if ((await page.locator('body').getAttribute('data-view')) === 'search')
    await page.keyboard.press('Escape');
}
// Phones have no visible cross: activate the button the way a screen reader does.
export async function closeCard(page) {
  const isPhone = page.viewportSize().width <= 720;
  if (isPhone) await page.locator('#close-place').dispatchEvent('click');
  else await page.locator('#close-place').click();
}
export const camera = (page) =>
  page.evaluate(() => {
    const map = window.kompasDebug.map;
    return {center: map.getCenter().toArray(), zoom: map.getZoom()};
  });
export async function settled(page) {
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
}
// Resolves once the map has drawn everything it has and nothing moves, including symbol placement after the last tile.
export const mapIdle = page =>
  page.evaluate(
    () =>
      new Promise(resolve => {
        const {map} = window.kompasDebug;
        // A repaint makes idle fire even when nothing is pending. map.loaded() would not do: it ignores symbol placement.
        map.once('idle', resolve);
        map.triggerRepaint();
      })
  );
// Checks that something does not happen. Absence has no state to wait on, so this repeats the assertion for as long as the
// app could still do it. The assertion must read once and not retry, or a brief failure in the middle would pass unseen.
export async function expectToHold(assertion, milliseconds) {
  const deadline = Date.now() + milliseconds;
  do {
    await assertion();
    await new Promise(resolve => setTimeout(resolve, HOLD_CHECK_MILLISECONDS));
  } while (Date.now() < deadline);
  await assertion();
}
export const expectCameraToHold = (page, expected, milliseconds = CAMERA_HOLD_MILLISECONDS) =>
  expectToHold(async () => expect(await camera(page)).toEqual(expected), milliseconds);
export async function pointOnMap(page, coordinates) {
  return page.evaluate((lngLat) => {
    const point = window.kompasDebug.map.project(lngLat);
    return {x: point.x, y: point.y};
  }, coordinates);
}
export async function ready(page) {
  await page.goto('./');
  await expect(page).not.toHaveURL(/\/web\//);
  await page.waitForFunction(
    () => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('search-place')
  );
  await expect(page.locator('#loading')).toBeHidden();
}
// A place is tapped where its icon is drawn: icons are always placed once a place reaches its level's zoom.
export async function tapRenderedPlace(page, coordinates, id) {
  await closeMenu(page);
  let point = null;
  for (const zoom of [17, 18, 19, 20, 21]) {
    await page.evaluate(({coordinates, zoom}) => window.kompasDebug.map.jumpTo({center: coordinates, zoom}), {
      coordinates,
      zoom
    });
    await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
    await mapIdle(page);
    point = await page.evaluate(
      ({coordinates, id}) => {
        const map = window.kompasDebug.map;
        const layers = map
          .getStyle()
          .layers.map((layer) => layer.id)
          .filter((layer) => layer.startsWith('place-icons-'));
        if (!map.queryRenderedFeatures({layers}).some((feature) => feature.id === id)) return null;
        const screenPoint = map.project(coordinates);
        const canvasBounds = map.getCanvas().getBoundingClientRect();
        return {x: canvasBounds.left + screenPoint.x, y: canvasBounds.top + screenPoint.y};
      },
      {coordinates, id}
    );
    if (point) break;
  }
  expect(point).not.toBeNull();
  await page.mouse.click(point.x, point.y);
}
export async function tapMapCenter(page, coordinates) {
  await closeMenu(page);
  await page.evaluate((point) => window.kompasDebug.map.jumpTo({center: point, zoom: 17}), coordinates);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  const point = await page.evaluate(() => {
    const map = window.kompasDebug.map;
    const screenPoint = map.project(map.getCenter());
    const canvasBounds = map.getCanvas().getBoundingClientRect();
    return {x: canvasBounds.left + screenPoint.x, y: canvasBounds.top + screenPoint.y};
  });
  await page.mouse.click(point.x, point.y);
}
export const nearbyPlaces = {
  type: 'FeatureCollection',
  features: Array.from({length: 6}, (_, index) => ({
    type: 'Feature',
    geometry: {type: 'Point', coordinates: [19.26 + index * 0.004, 42.44]},
    properties: {
      id: 'nearby/' + index,
      name: 'Nearby place ' + index,
      category: index % 2 ? 'food' : 'shops',
      kind: 'shop'
    }
  }))
};
export const simulateKeyboard = (page, height, scale = 1, offsetTop = 0) =>
  page.evaluate(
    ({visibleHeight, pageScale, pageOffset}) => {
      const viewport = new EventTarget();
      Object.assign(viewport, {height: visibleHeight, offsetTop: pageOffset, scale: pageScale});
      Object.defineProperty(window, 'visualViewport', {configurable: true, value: viewport});
      window.dispatchEvent(new Event('resize'));
    },
    {visibleHeight: height, pageScale: scale, pageOffset: offsetTop}
  );

// Run a scenario at a Flip cover-screen viewport (340×340) inside the existing mobile project.
// Restores the previous viewport even when the callback throws. Returns nothing.
export async function withFlipViewport(page, callback) {
  const previousViewport = page.viewportSize();
  await page.setViewportSize({width: 340, height: 340});
  try {
    await callback(page);
  } finally {
    await page.setViewportSize(previousViewport);
  }
}

// Run a check at a given viewport, restoring the previous one afterward.
// Returns whatever the callback returns.
export async function atViewport(page, viewport, check) {
  const previousViewport = page.viewportSize();
  await page.setViewportSize(viewport);
  try {
    return await check(page);
  } finally {
    await page.setViewportSize(previousViewport);
  }
}
