import {test, expect} from '@playwright/test';
import fs from 'node:fs';

// Software WebGL needs seconds per camera step, and these tests compare many exact camera steps.
test.describe.configure({timeout: 400000});

const THRESHOLDS = {1: 12, 2: 14, 3: 15, 4: 16, 5: 17};
// A meridian that is a tile boundary at every zoom from 12, so fixtures span tiles at every tested scale.
const LON = Math.round((19.26 + 180) / 360 * 2 ** 12) * 360 / 2 ** 12 - 180, LAT = 42.44;

function place(id, level, dx, dy, extra = {}) {
  return {type: 'Feature', geometry: {type: 'Point', coordinates: [LON + dx, LAT + dy]},
    properties: {id, name: `Place ${id}`, category: 'shops', kind: 'shop', visibilityLevel: level, ...extra}};
}
const collection = features => ({type: 'FeatureCollection', features});
// Interior of every viewport at zoom 17: 412 wide means about ±0.0011 degrees of longitude.
const ladder = () => collection([1, 2, 3, 4, 5].flatMap(level => [
  place(`l${level}-west`, level, -0.0002 * level, 0.00015 * level),
  place(`l${level}-east`, level, 0.0002 * level, -0.00015 * level)
]));
// Tight rows of long names: only some names can be placed, whichever arrangement the engine finds.
const dense = () => collection(Array.from({length: 40}, (_, i) => place(`dense-${String(i).padStart(2, '0')}`, 3 + i % 3,
  (i % 8 - 3.5) * 0.00012, (Math.floor(i / 8) - 2) * 0.00012, {name: `A deliberately long colliding business name ${i}`})));
const eligible = (data, zoom) => data.features.filter(f => zoom >= THRESHOLDS[f.properties.visibilityLevel]).map(f => f.properties.id).sort();

async function open(page, data, center = [LON, LAT], zoom = 17) {
  if (data) await page.route('**/data/places.geojson', route => route.fulfill({json: data}));
  await page.goto('./');
  await page.waitForFunction(() => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('search-place'));
  await expect(page.locator('#loading')).toBeHidden();
  await camera(page, {center, zoom});
}
const camera = (page, options) => page.evaluate(o => window.kompasDebug.map.jumpTo(o), options);
// What the icon layers actually drew, expanded from shared markers to the original listing IDs.
const iconIds = page => page.evaluate(() => {
  const m = window.kompasDebug.map;
  const layers = m.getStyle().layers.map(l => l.id).filter(id => id.startsWith('place-icons-') || id === 'search-place');
  return [...new Set(m.queryRenderedFeatures({layers}).flatMap(f => JSON.parse(f.properties.activeIds)))].sort();
});
// One entry per drawn marker, without de-duplicating, so a listing drawn twice is visible.
const drawnListings = page => page.evaluate(() => {
  const m = window.kompasDebug.map;
  const layers = m.getStyle().layers.map(l => l.id).filter(id => id.startsWith('place-icons-') || id === 'search-place');
  return m.queryRenderedFeatures({layers}).flatMap(f => JSON.parse(f.properties.activeIds)).sort();
});
const expectIcons = (page, expected) => expect.poll(() => iconIds(page)).toEqual([...expected].sort());
const screenPoint = (page, coordinates) => page.evaluate(c => {
  const m = window.kompasDebug.map, p = m.project(c), b = m.getCanvas().getBoundingClientRect();
  return {x: b.left + p.x, y: b.top + p.y};
}, coordinates);
async function tap(page, coordinates) {
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
  const {x, y} = await screenPoint(page, coordinates);
  await page.mouse.click(x, y);
}
async function openMenu(page) {
  if (await page.locator('#menu-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#menu-toggle').click();
}

test('every level is absent just below its threshold, present at it, and reversible', async ({page}) => {
  const data = ladder();
  await open(page, data);
  // Icon admission must not depend on the basemap (other tests keep it, with real label collisions). Without it, these
  // 30 camera steps across wide scales do not spend CI's time limit drawing streets in software WebGL.
  await page.evaluate(() => {
    const m = window.kompasDebug.map;
    for (const {id} of m.getStyle().layers) if (!/^place-|^search-place$/.test(id)) m.setLayoutProperty(id, 'visibility', 'none');
  });
  const zooms = Object.values(THRESHOLDS).flatMap(t => [t - 0.01, t, t + 0.01]);
  const up = [];
  for (const zoom of zooms) {
    await camera(page, {zoom});
    await expectIcons(page, eligible(data, zoom));
    up.push(await iconIds(page));
  }
  for (const [i, zoom] of [...zooms.entries()].reverse()) {
    await camera(page, {zoom});
    await expectIcons(page, up[i]);
  }
  for (let i = 1; i < up.length; i++) expect(up[i].filter(id => up[i - 1].includes(id))).toEqual(up[i - 1]);
});

test.describe('stability', () => {
// page.route cannot replace a request the service worker answers, and the reload below must see the reordered input.
test.use({serviceWorkers: 'block'});
test('small pans, zoom steps, bearing, round trips, reloads, and input order keep exact icon sets', async ({page}) => {
  const data = dense();
  await open(page, data, [LON, LAT], 17);
  const all = eligible(data, 17);
  await expectIcons(page, all);
  const before = await page.evaluate(() => window.kompasDebug.map.getCenter().toArray());
  for (const pixels of [1, 2, 5, 10, 20, -20, -10]) {
    await page.evaluate(x => window.kompasDebug.map.panBy([x, x / 2], {duration: 0}), pixels);
    await expectIcons(page, all);
  }
  for (const zoom of [17.01, 17.1, 17.3, 17.6, 18, 17.2, 17]) {
    await camera(page, {center: before, zoom});
    await expectIcons(page, all);
  }
  for (const bearing of [15, 90, 200, 0]) {
    await camera(page, {bearing});
    await expectIcons(page, all);
  }
  await camera(page, {zoom: 15.5});
  await expectIcons(page, eligible(data, 15.5));
  await camera(page, {zoom: 16.5});
  await expectIcons(page, eligible(data, 16.5));
  await camera(page, {zoom: 17});
  await expectIcons(page, all);

  // Intermediate frames of warmed-up animations, not only the settled endpoints.
  const frames = await page.evaluate(async ({lon, lat}) => {
    const m = window.kompasDebug.map, seen = [];
    const layers = m.getStyle().layers.map(l => l.id).filter(id => id.startsWith('place-icons-'));
    const sample = () => seen.push([m.getZoom(), [...new Set(m.queryRenderedFeatures({layers}).flatMap(f => JSON.parse(f.properties.activeIds)))].sort()]);
    m.on('render', sample);
    const animate = options =>
      new Promise(resolve => {
        m.once('moveend', resolve);
        m.easeTo({...options, duration: 500});
      });
    await animate({center: [lon + 0.00005, lat]});
    await animate({center: [lon, lat]});
    await animate({zoom: 17.4});
    await animate({zoom: 17});
    m.off('render', sample);
    return seen;
  }, {lon: LON, lat: LAT});
  expect(frames.length).toBeGreaterThan(10);
  for (const [zoom, ids] of frames) expect(ids, `frame at zoom ${zoom}`).toEqual(eligible(data, zoom));

  // Input order is not an input: the reversed snapshot gives the same IDs and the same draw order.
  const order = () => page.evaluate(() => window.kompasDebug.map.getSource('places')._data.features.map(f => [f.properties.markerKey, f.properties.rank]));
  const ranks = await order();
  await page.unroute('**/data/places.geojson');
  await open(page, collection([...data.features].reverse()));
  await expectIcons(page, all);
  expect(await order()).toEqual(ranks);
});

test('an earlier level moves only the overridden place and leaves search order alone', async ({page}) => {
  const base = ladder(), promoted = structuredClone(base);
  promoted.features.find(f => f.properties.id === 'l5-west').properties.visibilityLevel = 2;
  const results = async () => {
    await openMenu(page);
    await expect(page.locator('.result')).toHaveCount(base.features.length);
    return page.locator('.result').evaluateAll(rows => rows.map(row => row.dataset.id));
  };
  await open(page, base, [LON, LAT], 14);
  await expectIcons(page, eligible(base, 14));
  const order = await results();
  await page.unroute('**/data/places.geojson');
  await open(page, promoted, [LON, LAT], 14);
  await expectIcons(page, [...eligible(base, 14), 'l5-west']);
  await camera(page, {zoom: 16});
  await expectIcons(page, [...eligible(base, 16), 'l5-west']);
  await camera(page, {zoom: 14});
  await expect.poll(results).toEqual(order);
});
});

test('name collisions never remove an eligible icon', async ({page}) => {
  const data = dense();
  await open(page, data);
  await expectIcons(page, eligible(data, 17));
  const named = await page.evaluate(() => {
    const m = window.kompasDebug.map;
    const layers = m.getStyle().layers.map(l => l.id).filter(id => id.startsWith('place-names-'));
    return new Set(m.queryRenderedFeatures({layers}).map(f => f.id)).size;
  });
  expect(named).toBeGreaterThan(0);
  expect(named).toBeLessThan(data.features.length);
});

test('an icon on a house number keeps both the icon and the address label', async ({page}) => {
  const label = JSON.parse(fs.readFileSync(new URL('../../../../data/sources/building-labels.geojson', import.meta.url))).features[0];
  const data = collection([{type: 'Feature', geometry: {type: 'Point', coordinates: label.geometry.coordinates},
    properties: {id: 'on-address', name: 'A deliberately long business name on an address', category: 'shops', kind: 'shop', visibilityLevel: 4}}]);
  await open(page, data, label.geometry.coordinates, 20);
  await expectIcons(page, ['on-address']);
  await expect.poll(() => page.evaluate(id => window.kompasDebug.map.queryRenderedFeatures({layers: ['building-numbers']}).some(f => f.properties.osm_id === id), label.id)).toBe(true);
});

test('co-located listings share one stable marker and a keyboard chooser with real identities', {tag: '@phone'}, async ({page}) => {
  const c = [0.0003, 0.0003];
  const data = collection([place('z-shop', 5, ...c), place('a-museum', 2, ...c, {category: 'sights', kind: 'museum'}), place('m-cafe', 4, ...c, {category: 'food', kind: 'cafe'}), place('apart', 3, -0.0005, -0.0005)]);
  const coordinates = data.features[0].geometry.coordinates;
  await open(page, data, coordinates, 14);
  const marker = () => page.evaluate(() => {
    const m = window.kompasDebug.map;
    const layers = m.getStyle().layers.map(l => l.id).filter(id => id.startsWith('place-icons-'));
    return m.queryRenderedFeatures({layers}).filter(f => f.properties.markerKey.startsWith('shared:')).map(f => [f.properties.icon, f.properties.count, JSON.parse(f.properties.activeIds)]);
  });
  await expect.poll(marker).toEqual([['place-sights', '', ['a-museum']]]);
  await camera(page, {zoom: 16});
  await expect.poll(marker).toEqual([['place-shared', '2', ['a-museum', 'm-cafe']]]);
  await camera(page, {zoom: 17});
  await expect.poll(marker).toEqual([['place-shared', '3', ['a-museum', 'm-cafe', 'z-shop']]]);
  await tap(page, coordinates);
  await expect(page.locator('#place-name')).toHaveText('3 places here');
  await expect(page.locator('#point-actions')).toBeHidden();
  const options = page.locator('.place-chooser .result');
  await expect(options).toHaveCount(3);
  expect(await options.evaluateAll(rows => rows.map(row => row.dataset.id))).toEqual(['a-museum', 'm-cafe', 'z-shop']);
  await expect(options.first()).toBeFocused();
  for (const box of await options.evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(40);
  await page.keyboard.press('Tab');
  await expect(options.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#place-name')).toHaveText('Place m-cafe');
  await expect(page.locator('#point-actions')).toBeVisible();
  await page.locator('#point-from').click();
  expect((await page.evaluate(() => window.kompasDebug.endpoints)).from.coordinates).toEqual(coordinates);
  // Recenter first: on a phone the endpoint panel now covers where the marker was left.
  await camera(page, {center: coordinates});
  await tap(page, coordinates);
  // A route endpoint keeps hit precedence over the marker beneath it.
  await expect(page.locator('#place-category')).toHaveText('From point');
});

test('overlapping nearby markers open a chooser instead of picking the first rendered feature', async ({page}) => {
  const data = collection([place('near-a', 4, 0, 0), place('near-b', 4, 0.00002, 0)]);
  await open(page, data);
  await expectIcons(page, ['near-a', 'near-b']);
  await tap(page, data.features[0].geometry.coordinates);
  await expect(page.locator('#place-name')).toHaveText('2 places here');
  await page.locator('.place-chooser .result[data-id="near-b"]').click();
  await expect(page.locator('#place-name')).toHaveText('Place near-b');
  await expect(page.locator('#place-details')).toContainText(data.features[1].geometry.coordinates[1].toFixed(5));
});

test('a chooser opened with search open is usable at once and keeps the search', {tag: '@phone'}, async ({page, isMobile}) => {
  const data = collection([place('near-a', 4, 0, 0), place('near-b', 4, 0.00002, 0)]);
  const coordinates = data.features[0].geometry.coordinates;
  await open(page, data, coordinates);
  await page.locator('#search').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', isMobile ? 'search' : 'dock');
  // Move the markers clear of the search panel, into the map area still visible beside or below it.
  await page.evaluate(([x, y]) => window.kompasDebug.map.panBy([x, y], {duration: 0}), isMobile ? [0, -200] : [-200, 0]);
  await expectIcons(page, ['near-a', 'near-b']);
  await tap(page, coordinates);
  await expect(page.locator('#place-name')).toHaveText('2 places here');
  await expect(page.locator('body')).toHaveAttribute('data-view', isMobile ? 'search' : 'dock');
  if (isMobile) await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'full');
  const first = page.locator('.place-chooser .result').first();
  await expect(first).toBeVisible();
  await expect(first).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#place-name')).toHaveText('Place near-a');
});

test('typing closes an open chooser, whose listings may no longer match', async ({page}) => {
  const data = collection([place('near-a', 4, 0, 0), place('near-b', 4, 0.00002, 0)]);
  await open(page, data);
  await expectIcons(page, ['near-a', 'near-b']);
  await tap(page, data.features[0].geometry.coordinates);
  await expect(page.locator('#place-name')).toHaveText('2 places here');
  await page.locator('#search').fill('near-b');
  await expect(page.locator('#place-card')).toBeHidden();
  await expect(page.locator('#results .result')).toHaveCount(1);
});

test('the camera holds still for a chooser while the phone keyboard is open', {tag: '@phone'}, async ({page, isMobile}) => {
  test.skip(!isMobile, 'phone keyboard');
  const data = collection([place('near-a', 4, 0, 0), place('near-b', 4, 0.00002, 0)]);
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
  await expect(page.locator('#place-name')).toHaveText('2 places here');
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => window.kompasDebug.map.getCenter().toArray())).toEqual(before);
  // The keyboard closes: the pending check now runs against the full map area.
  await page.evaluate(() => {
    Object.assign(window.visualViewport, {height: 840});
    window.dispatchEvent(new Event('resize'));
  });
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getCenter().toArray())).not.toEqual(before);
});

test('the leading match keeps its ring at its threshold, with one icon and no exception layer', async ({page}) => {
  const data = collection([place('only-match', 4, 0, 0), place('other', 4, 0.0004, 0)]);
  const ring = id => page.evaluate(key => window.kompasDebug.map.getFeatureState({source: 'places', id: key}).preview, id);
  await open(page, data, data.features[0].geometry.coordinates, 16);
  await page.locator('#search').fill('only-match');
  await expect.poll(() => ring('only-match')).toBe(true);
  await expect.poll(() => drawnListings(page)).toEqual(['only-match']);
  expect(await page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['search-place']}).length)).toBe(0);
  await page.locator('#search').fill('');
  await expect.poll(() => ring('only-match')).toBe(false);
});

test('a broad filter admits only eligible matches plus one exception that moves and clears', async ({page}) => {
  const data = ladder();
  await open(page, data);
  await page.locator('#search').fill('Place');
  // The leading result appears once the debounced filter applies.
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getSource('requested-place')._data.features.length)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
  await camera(page, {center: [LON, LAT], zoom: 9});
  const leading = await page.evaluate(() => window.kompasDebug.map.getSource('requested-place')._data.features.map(f => JSON.parse(f.properties.activeIds)[0]));
  expect(leading).toHaveLength(1);
  await expectIcons(page, leading);

  // Choosing another result moves the single exception and keeps it through zooming out.
  await page.locator('.result[data-id="l5-east"]').click();
  await expect(page.locator('#place-name')).toHaveText('Place l5-east');
  // Opening the card may recenter the map around it, so each step below sets the center as well as the zoom.
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
  await camera(page, {center: [LON, LAT], zoom: 9});
  await expectIcons(page, ['l5-east']);
  // No listing is ever drawn twice: below, just below, at, and above its own threshold.
  for (const [zoom, expected] of [[9, ['l5-east']], [16.99, ['l5-east', ...eligible(data, 16.99)]], [17, eligible(data, 17)], [17.01, eligible(data, 17.01)]]) {
    await camera(page, {center: [LON, LAT], zoom});
    await expect.poll(() => drawnListings(page)).toEqual([...expected].sort());
  }
  // Phones have no visible close button; it stays available to screen readers.
  await page.locator('#close-place').dispatchEvent('click');
  await camera(page, {center: [LON, LAT], zoom: 9});
  await expectIcons(page, []);

  // Clearing the filter removes the preview exception.
  await page.locator('#search').fill('');
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getSource('requested-place')._data.features.length)).toBe(0);
  await camera(page, {zoom: 9});
  await expectIcons(page, []);
});

test('a category keeps thresholds, untoggles cleanly, and leaves the directory complete', async ({page}) => {
  const data = collection([place('cafe-low', 2, 0, 0, {category: 'food', kind: 'cafe'}), place('cafe-high', 5, 0.0004, 0, {category: 'food', kind: 'cafe'}), place('shop', 2, -0.0004, 0)]);
  await open(page, data, [LON, LAT], 15);
  await expectIcons(page, ['cafe-low', 'shop']);
  await openMenu(page);
  const food = page.locator('#categories').getByRole('button', {name: 'Eat & drink', exact: true});
  await food.click();
  await expect(page.locator('.result')).toHaveCount(2);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
  await camera(page, {center: [LON, LAT], zoom: 15});
  const leading = await page.evaluate(() => window.kompasDebug.map.getSource('requested-place')._data.features[0].properties.activeIds);
  await expectIcons(page, [...new Set(['cafe-low', ...JSON.parse(leading)])]);
  await food.click();
  await expect(page.locator('.result')).toHaveCount(3);
  await camera(page, {center: [LON, LAT], zoom: 15});
  await expectIcons(page, ['cafe-low', 'shop']);
});

test('turning map layers on and off keeps the same icon set', async ({page}) => {
  await page.route('https://cg-map-transit-relay.arcane-pond-2083.chatgpt.site/api/vehicles', route => route.fulfill({status: 503, json: {error: 'unavailable'}}));
  const data = ladder(), expected = eligible(data, 16);
  await open(page, data, [LON, LAT], 16);
  await expectIcons(page, expected);
  for (const name of ['Satellite', 'Transport']) for (const pressed of ['true', 'false']) {
    await openMenu(page);
    const toggle = page.getByRole('button', {name, exact: true});
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', pressed);
    await page.locator('#menu-toggle').click();
    // Turning a layer on moves the camera to it; come back to compare the same scene.
    await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
    await camera(page, {center: [LON, LAT], zoom: 16});
    await expectIcons(page, expected);
  }
});

test('an invalid level fails visibly instead of becoming high priority', async ({page}) => {
  const data = ladder();
  data.features[0].properties.visibilityLevel = 0;
  await page.route('**/data/places.geojson', route => route.fulfill({json: data}));
  await page.goto('./');
  await expect(page.locator('#error-text')).toContainText('invalid visibilityLevel');
});

test('level metadata is an offline shell asset and offline reload keeps the same icons', async ({page, context}) => {
  await open(page, null, [19.2627, 42.4411], 17);
  await expect.poll(async () => (await iconIds(page)).length).toBeGreaterThan(5);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  await openMenu(page);
  await expect(page.locator('#download')).toBeEnabled();
  await page.locator('#download').click();
  await page.waitForFunction(() => window.kompasDebug.offline, null, {timeout: 60000});
  const manifest = await page.evaluate(() => fetch('data/manifest.json').then(r => r.json()));
  expect(manifest.shell).toEqual(expect.arrayContaining(['data/place-visibility.json', 'map-core/place-visibility.js', 'data/places.geojson']));
  await page.locator('#menu-toggle').click();
  await camera(page, {center: [19.2627, 42.4411], zoom: 17});
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  const online = await iconIds(page);
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.kompasDebug?.offline && window.kompasDebug.map.getLayer('search-place'));
  await expect(page.locator('#loading')).toBeHidden();
  await camera(page, {center: [19.2627, 42.4411], zoom: 17});
  await expectIcons(page, online);
});

// A manual review aid, not an acceptance check: POI_DENSITY_SCREENSHOTS=1 npm run test:e2e -- --grep 'density review'
test('real data at every threshold, for visual density review', async ({page}, testInfo) => {
  test.skip(!process.env.POI_DENSITY_SCREENSHOTS, 'Run on request after changing levels');
  const places = JSON.parse(fs.readFileSync(new URL('../../../../data/sources/places.geojson', import.meta.url))).features;
  await open(page, null);
  const scenes = {podgorica: [19.2627, 42.4411], 'dense-west': [19.24, 42.44], coast: [18.84, 42.286]};
  for (const [name, center] of Object.entries(scenes)) for (const zoom of Object.values(THRESHOLDS)) {
    await camera(page, {center, zoom});
    await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded()), {timeout: 30000}).toBe(true);
    await page.waitForTimeout(400);
    const ids = await iconIds(page);
    const known = new Map(places.map(f => [f.properties.id, f.properties.visibilityLevel]));
    for (const id of ids) expect(zoom).toBeGreaterThanOrEqual(THRESHOLDS[known.get(id)]);
    await page.screenshot({path: testInfo.outputPath(`${name}-z${zoom}-${ids.length}.png`)});
  }
});
