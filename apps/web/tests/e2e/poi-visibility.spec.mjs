import {test, expect} from '@playwright/test';
import {readPinnedSource} from '../pinned-data.mjs';
import {CAMERA_HOLD_MILLISECONDS, expectToHold, mapIdle} from './helpers.mjs';

// Software WebGL needs seconds per camera step, and these tests compare many exact camera steps.
test.describe.configure({timeout: 400000});

const THRESHOLDS = {1: 12, 2: 14, 3: 15, 4: 16, 5: 17};
// A meridian that is a tile boundary at every zoom from 12, so fixtures span tiles at every tested scale.
const TILE_BOUNDARY_LONGITUDE_DEGREES = (Math.round(((19.26 + 180) / 360) * 2 ** 12) * 360) / 2 ** 12 - 180;
const CENTER_LATITUDE_DEGREES = 42.44;

function place(id, level, longitudeOffsetDegrees, latitudeOffsetDegrees, extra = {}) {
  return {
    type: 'Feature',
    geometry: {
      type: 'Point',
      coordinates: [
        TILE_BOUNDARY_LONGITUDE_DEGREES + longitudeOffsetDegrees,
        CENTER_LATITUDE_DEGREES + latitudeOffsetDegrees
      ]
    },
    properties: {id, name: `Place ${id}`, category: 'shops', kind: 'shop', visibilityLevel: level, ...extra}
  };
}
const featureCollection = (features) => ({type: 'FeatureCollection', features});
// Interior of every viewport at zoom 17: 412 wide means about ±0.0011 degrees of longitude.
const ladder = () =>
  featureCollection(
    [1, 2, 3, 4, 5].flatMap((level) => [
      place(`l${level}-west`, level, -0.0002 * level, 0.00015 * level),
      place(`l${level}-east`, level, 0.0002 * level, -0.00015 * level)
    ])
  );
const eligible = (data, zoom) =>
  data.features
    .filter((feature) => zoom >= THRESHOLDS[feature.properties.visibilityLevel])
    .map((feature) => feature.properties.id)
    .sort();

async function open(
  page,
  data,
  center = [TILE_BOUNDARY_LONGITUDE_DEGREES, CENTER_LATITUDE_DEGREES],
  zoom = 17
) {
  if (data) await page.route('**/data/places.geojson', (route) => route.fulfill({json: data}));
  await page.goto('./');
  await page.waitForFunction(
    () => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('search-place')
  );
  await expect(page.locator('#loading')).toBeHidden();
  await camera(page, {center, zoom});
}
const camera = (page, options) =>
  page.evaluate((cameraOptions) => window.kompasDebug.map.jumpTo(cameraOptions), options);
// What the icon layers actually drew, expanded from shared markers to the original listing IDs.
const iconIds = (page) =>
  page.evaluate(() => {
    const map = window.kompasDebug.map;
    const layers = map
      .getStyle()
      .layers.map((layer) => layer.id)
      .filter((id) => id.startsWith('place-icons-') || id === 'search-place');
    return [
      ...new Set(
        map.queryRenderedFeatures({layers}).flatMap((feature) => JSON.parse(feature.properties.activeIds))
      )
    ].sort();
  });
// One entry per drawn marker, without de-duplicating, so a listing drawn twice is visible.
const drawnListings = (page) =>
  page.evaluate(() => {
    const map = window.kompasDebug.map;
    const layers = map
      .getStyle()
      .layers.map((layer) => layer.id)
      .filter((id) => id.startsWith('place-icons-') || id === 'search-place');
    return map
      .queryRenderedFeatures({layers})
      .flatMap((feature) => JSON.parse(feature.properties.activeIds))
      .sort();
  });
const expectIcons = (page, expected) => expect.poll(() => iconIds(page)).toEqual([...expected].sort());
const screenPoint = (page, coordinates) =>
  page.evaluate((coordinates) => {
    const map = window.kompasDebug.map;
    const screenPoint = map.project(coordinates);
    const canvasBounds = map.getCanvas().getBoundingClientRect();
    return {x: canvasBounds.left + screenPoint.x, y: canvasBounds.top + screenPoint.y};
  }, coordinates);
async function tap(page, coordinates) {
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
  const {x, y} = await screenPoint(page, coordinates);
  await page.mouse.click(x, y);
}
async function openMenu(page) {
  if ((await page.locator('#menu-toggle').getAttribute('aria-expanded')) !== 'true')
    await page.locator('#menu-toggle').click();
}

// Every level's own threshold is a unit test of the layers in packages/map-core. What only an engine can prove is that its
// inclusive minzoom behaves at fractional zooms, the same at any threshold, so this crosses one, both ways.

test.describe('stability', () => {
  // page.route cannot replace a request the service worker answers, and the reload below must see the reordered input.
  test.use({serviceWorkers: 'block'});

});

test('an icon on a house number keeps both the icon and the address label', async ({page}) => {
  const label = JSON.parse(
    readPinnedSource('building-labels.geojson')
  ).features[0];
  const data = featureCollection([
    {
      type: 'Feature',
      geometry: {type: 'Point', coordinates: label.geometry.coordinates},
      properties: {
        id: 'on-address',
        name: 'A deliberately long business name on an address',
        category: 'shops',
        kind: 'shop',
        visibilityLevel: 4
      }
    }
  ]);
  await open(page, data, label.geometry.coordinates, 20);
  await expectIcons(page, ['on-address']);
  await expect
    .poll(() =>
      page.evaluate(
        (id) =>
          window.kompasDebug.map
            .queryRenderedFeatures({layers: ['building-numbers']})
            .some((feature) => feature.properties.osm_id === id),
        label.id
      )
    )
    .toBe(true);
});

test(
  'co-located listings share one stable marker and a tap opens its topmost listing',
  {tag: '@phone'},
  async ({page}) => {
    const coordinateOffsetsDegrees = [0.0003, 0.0003];
    const data = featureCollection([
      place('z-shop', 5, ...coordinateOffsetsDegrees),
      place('a-museum', 2, ...coordinateOffsetsDegrees, {category: 'sights', kind: 'museum'}),
      place('m-cafe', 4, ...coordinateOffsetsDegrees, {category: 'food', kind: 'cafe'}),
      place('apart', 3, -0.0005, -0.0005)
    ]);
    const coordinates = data.features[0].geometry.coordinates;
    await open(page, data, coordinates, 14);
    const marker = () =>
      page.evaluate(() => {
        const map = window.kompasDebug.map;
        const layers = map
          .getStyle()
          .layers.map((layer) => layer.id)
          .filter((id) => id.startsWith('place-icons-'));
        return map
          .queryRenderedFeatures({layers})
          .filter((feature) => feature.properties.markerKey.startsWith('shared:'))
          .map((feature) => [
            feature.properties.icon,
            feature.properties.count,
            JSON.parse(feature.properties.activeIds)
          ]);
      });
    await expect.poll(marker).toEqual([['place-sights', '', ['a-museum']]]);
    await camera(page, {zoom: 16});
    await expect.poll(marker).toEqual([['place-shared', '2', ['a-museum', 'm-cafe']]]);
    await camera(page, {zoom: 17});
    await expect.poll(marker).toEqual([['place-shared', '3', ['a-museum', 'm-cafe', 'z-shop']]]);
    await tap(page, coordinates);
    // The shared marker's active identities are ranked; the first one opens directly.
    await expect(page.locator('#place-name')).toHaveText('Place a-museum');
    await expect(page.locator('#point-actions')).toBeVisible();
    await expect(page.locator('.place-chooser')).toHaveCount(0);
    await page.locator('#point-from').click();
    expect((await page.evaluate(() => window.kompasDebug.endpoints)).from.coordinates).toEqual(coordinates);
    // Recenter first: on a phone the endpoint panel now covers where the marker was left.
    await camera(page, {center: coordinates});
    await tap(page, coordinates);
    // A route endpoint keeps hit precedence over the marker beneath it.
    await expect(page.locator('#place-category')).toHaveText('From point');
  }
);

test('overlapping nearby markers open the first rendered feature directly', async ({page}) => {
  const data = featureCollection([place('near-a', 4, 0, 0), place('near-b', 4, 0.00002, 0)]);
  await open(page, data);
  await expectIcons(page, ['near-a', 'near-b']);
  await tap(page, data.features[0].geometry.coordinates);
  await expect(page.locator('#place-name')).toHaveText('Place near-b');
  await expect(page.locator('.place-chooser')).toHaveCount(0);
  await expect(page.locator('#place-details')).toContainText(
    data.features[1].geometry.coordinates[1].toFixed(5)
  );
});

test(
  'a marker tapped with search open opens its card and keeps the search',
  {tag: '@phone'},
  async ({page, isMobile}) => {
    const data = featureCollection([place('near-a', 4, 0, 0), place('near-b', 4, 0.00002, 0)]);
    const coordinates = data.features[0].geometry.coordinates;
    await open(page, data, coordinates);
    await page.locator('#search').click();
    await expect(page.locator('body')).toHaveAttribute('data-view', isMobile ? 'search' : 'closed');
    // Move the markers clear of the search panel, into the map area still visible beside or below it.
    await page.evaluate(
      ([x, y]) => window.kompasDebug.map.panBy([x, y], {duration: 0}),
      isMobile ? [0, -200] : [-200, 0]
    );
    await expectIcons(page, ['near-a', 'near-b']);
    await tap(page, coordinates);
    await expect(page.locator('#place-name')).toHaveText('Place near-b');
    await expect(page.locator('body')).toHaveAttribute('data-view', isMobile ? 'search' : 'closed');
    if (isMobile) await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'peek');
    await expect(page.locator('#point-actions')).toBeVisible();
  }
);

test('typing closes a selected marker card when its listing no longer matches', async ({page}) => {
  const data = featureCollection([place('near-a', 4, 0, 0), place('near-b', 4, 0.00002, 0)]);
  await open(page, data);
  await expectIcons(page, ['near-a', 'near-b']);
  await tap(page, data.features[0].geometry.coordinates);
  await expect(page.locator('#place-name')).toHaveText('Place near-b');
  await page.locator('#search').fill('near-a');
  await expect(page.locator('#place-card')).toBeHidden();
  await expect(page.locator('#results .result')).toHaveCount(1);
});

test(
  'the camera holds still for a selected marker while the phone keyboard is open',
  {tag: ['@phone', '@phone-only']},
  async ({page}) => {
    const data = featureCollection([place('near-a', 4, 0, 0), place('near-b', 4, 0.00002, 0)]);
    const coordinates = data.features[0].geometry.coordinates;
    await open(page, data, coordinates);
    await page.locator('#search').click();
    await page.evaluate(() => {
      const viewport = new EventTarget();
      Object.assign(viewport, {height: 420, offsetTop: 0});
      Object.defineProperty(window, 'visualViewport', {configurable: true, value: viewport});
      window.dispatchEvent(new Event('resize'));
    });
    // Below the search panel, but near the edge of the small visible area, so a reveal would have to move the map.
    await page.evaluate(() => window.kompasDebug.map.panBy([150, 110], {duration: 0}));
    await expectIcons(page, ['near-a', 'near-b']);
    const before = await page.evaluate(() => window.kompasDebug.map.getCenter().toArray());
    await tap(page, coordinates);
    await expect(page.locator('#place-name')).toHaveText('Place near-b');
    await expectToHold(
      async () => expect(await page.evaluate(() => window.kompasDebug.map.getCenter().toArray())).toEqual(before),
      CAMERA_HOLD_MILLISECONDS
    );
    // The keyboard closes: the pending check now runs against the full map area.
    await page.evaluate(() => {
      Object.assign(window.visualViewport, {height: 840});
      window.dispatchEvent(new Event('resize'));
    });
    await expect
      .poll(() => page.evaluate(() => window.kompasDebug.map.getCenter().toArray()))
      .not.toEqual(before);
  }
);

test('a query keeps other places while the leading match keeps its icon exception', async ({page}) => {
  const data = featureCollection([place('only-match', 4, 0, 0), place('other', 4, 0.0004, 0)]);
  const hasPreview = (id) =>
    page.evaluate((key) => Boolean(window.kompasDebug.map.getFeatureState({source: 'places', id: key}).preview), id);
  await open(page, data, data.features[0].geometry.coordinates, 16);
  await page.locator('#search').fill('only-match');
  await expect(page.locator('.result')).toHaveCount(1);
  await expect.poll(() => drawnListings(page)).toEqual(['only-match', 'other']);
  await mapIdle(page);
  expect(await hasPreview('only-match')).toBe(false);
  expect(
    await page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['search-place']}).length)
  ).toBe(0);
  await page.locator('#search').fill('');
  await mapIdle(page);
  expect(await hasPreview('only-match')).toBe(false);
});

test('a broad filter admits only eligible matches plus one exception that moves and clears', async ({page}) => {
  const data = ladder();
  await open(page, data);
  await page.locator('#search').fill('Place');
  // The leading result appears once the debounced filter applies.
  await expect
    .poll(() =>
      page.evaluate(() => window.kompasDebug.map.getSource('requested-place')._data.features.length)
    )
    .toBe(1);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
  await camera(page, {center: [TILE_BOUNDARY_LONGITUDE_DEGREES, CENTER_LATITUDE_DEGREES], zoom: 9});
  const leading = await page.evaluate(() =>
    window.kompasDebug.map
      .getSource('requested-place')
      ._data.features.map((feature) => JSON.parse(feature.properties.activeIds)[0])
  );
  expect(leading).toHaveLength(1);
  await expectIcons(page, leading);

  // Choosing another result moves the single exception and keeps it through zooming out.
  await page.locator('.result[data-id="l5-east"]').click();
  await expect(page.locator('#place-name')).toHaveText('Place l5-east');
  // Opening the card may recenter the map around it, so each step below sets the center as well as the zoom.
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
  await camera(page, {center: [TILE_BOUNDARY_LONGITUDE_DEGREES, CENTER_LATITUDE_DEGREES], zoom: 9});
  await expectIcons(page, ['l5-east']);
  // No listing is ever drawn twice: below, just below, at, and above its own threshold.
  for (const [zoom, expected] of [
    [9, ['l5-east']],
    [16.99, ['l5-east', ...eligible(data, 16.99)]],
    [17, eligible(data, 17)],
    [17.01, eligible(data, 17.01)]
  ]) {
    await camera(page, {center: [TILE_BOUNDARY_LONGITUDE_DEGREES, CENTER_LATITUDE_DEGREES], zoom});
    await expect.poll(() => drawnListings(page)).toEqual([...expected].sort());
  }
  // Phones have no visible close button; it stays available to screen readers.
  await page.locator('#close-place').dispatchEvent('click');
  await camera(page, {center: [TILE_BOUNDARY_LONGITUDE_DEGREES, CENTER_LATITUDE_DEGREES], zoom: 9});
  await expectIcons(page, []);

  // Clearing the filter removes the preview exception.
  await page.locator('#search').fill('');
  await expect
    .poll(() =>
      page.evaluate(() => window.kompasDebug.map.getSource('requested-place')._data.features.length)
    )
    .toBe(0);
  await camera(page, {zoom: 9});
  await expectIcons(page, []);
});

test('a category keeps thresholds, untoggles cleanly, and leaves the directory complete', async ({page}) => {
  const data = featureCollection([
    place('cafe-low', 2, 0, 0, {category: 'food', kind: 'cafe'}),
    place('cafe-high', 5, 0.0004, 0, {category: 'food', kind: 'cafe'}),
    place('shop', 2, -0.0004, 0)
  ]);
  await open(page, data, [TILE_BOUNDARY_LONGITUDE_DEGREES, CENTER_LATITUDE_DEGREES], 15);
  await expectIcons(page, ['cafe-low', 'shop']);
  await openMenu(page);
  const food = page.locator('#categories').getByRole('button', {name: 'Eat & drink', exact: true});
  await food.click();
  await expect(page.locator('.result')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
  await camera(page, {center: [TILE_BOUNDARY_LONGITUDE_DEGREES, CENTER_LATITUDE_DEGREES], zoom: 15});
  const leading = await page.evaluate(
    () => window.kompasDebug.map.getSource('requested-place')._data.features[0].properties.activeIds
  );
  await expectIcons(page, [...new Set(['cafe-low', ...JSON.parse(leading)])]);
  await food.click();
  await expect(page.locator('.result')).toHaveCount(3);
  await camera(page, {center: [TILE_BOUNDARY_LONGITUDE_DEGREES, CENTER_LATITUDE_DEGREES], zoom: 15});
  await expectIcons(page, ['cafe-low', 'shop']);
});

test('turning map layers on and off keeps the same icon set', async ({page}) => {
  await page.route('https://cg-map-transit-relay.arcane-pond-2083.chatgpt.site/api/vehicles', (route) =>
    route.fulfill({status: 503, json: {error: 'unavailable'}})
  );
  const data = ladder();
  const expected = eligible(data, 16);
  await open(page, data, [TILE_BOUNDARY_LONGITUDE_DEGREES, CENTER_LATITUDE_DEGREES], 16);
  await expectIcons(page, expected);
  for (const name of ['Satellite', 'Transport'])
    for (const pressed of ['true', 'false']) {
      await openMenu(page);
      const toggle = page.getByRole('button', {name, exact: true});
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-pressed', pressed);
      await page.locator('#menu-toggle').click();
      // Turning a layer on moves the camera to it; come back to compare the same scene.
      await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
      await camera(page, {center: [TILE_BOUNDARY_LONGITUDE_DEGREES, CENTER_LATITUDE_DEGREES], zoom: 16});
      await expectIcons(page, expected);
    }
});

test('level metadata is an offline shell asset and offline reload keeps the same icons', async ({
  page,
  context
}) => {
  await open(page, null, [19.2627, 42.4411], 17);
  await expect.poll(async () => (await iconIds(page)).length).toBeGreaterThan(5);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  await openMenu(page);
  await expect(page.locator('#download')).toBeEnabled();
  await page.locator('#download').click();
  await page.waitForFunction(() => window.kompasDebug.offline, null, {timeout: 60000});
  const manifest = await page.evaluate(() => fetch('data/manifest.json').then((response) => response.json()));
  expect(manifest.shell).toEqual(
    expect.arrayContaining([
      'data/place-visibility.json',
      'map-core/place-visibility.js',
      'data/places.geojson'
    ])
  );
  await page.locator('#menu-toggle').click();
  await camera(page, {center: [19.2627, 42.4411], zoom: 17});
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  const online = await iconIds(page);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(
    () => window.kompasDebug?.offline && window.kompasDebug.map.getLayer('search-place')
  );
  await expect(page.locator('#loading')).toBeHidden();
  await camera(page, {center: [19.2627, 42.4411], zoom: 17});
  await expectIcons(page, online);
});
