import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {closeCard, fixture, openMenu, ready, stubRouting, tapMapCenter} from './helpers.mjs';

test.beforeEach(({page}) => stubRouting(page));

test('map, fixture search, selection, and satellite preserve the map instance', async ({page, isMobile}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
  await ready(page);
  expect(await page.evaluate(() => window.kompasDebug.placeCount)).toBe(fixture.features.length);
  await openMenu(page);
  await page.locator('.result').first().click();
  await expect(page.locator('#place-card')).toBeVisible();
  await closeCard(page);
  await expect(page.locator('#place-card')).toBeHidden();
  // Choosing a result leaves the phone dock for compact search; the desktop dock stays. Either way the row is kept.
  await expect(page.locator('.result').first()).toBeFocused();
  await expect(page.locator('body')).toHaveAttribute('data-view', isMobile ? 'search' : 'dock');
  await page.locator('#search').fill(fixture.features[0].properties.name);
  await expect.poll(() => page.locator('.result').count()).toBeGreaterThan(0);
  await page.locator('#search').fill('');
  await expect(page.locator('.result')).toHaveCount(fixture.features.length);
  await page.evaluate(() => {window.originalMap = window.kompasDebug.map;});
  await openMenu(page);
  await page.getByRole('button', {name: 'Satellite', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.kompasDebug.satellite)).toBe(true);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  await openMenu(page);
  await page.getByRole('button', {name: 'Satellite', exact: true}).click();
  expect(await page.evaluate(() => window.originalMap === window.kompasDebug.map)).toBe(true);
  expect(errors).toEqual([]);
});

test('shipped snapshot downloads and reloads offline with real archive data', async ({page, context}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await openMenu(page);
  await expect(page.locator('#download')).toBeEnabled();
  await page.locator('#download').click();
  await page.waitForFunction(() => window.kompasDebug.offline, null, {timeout: 60000});
  await expect(page.locator('#download-state')).toHaveText('READY');
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.kompasDebug?.offline && window.kompasDebug.map.getLayer('search-place'));
  await expect(page.locator('#loading')).toBeHidden();
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.256, 42.442], zoom: 16}));
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  await openMenu(page);
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.254951, 42.446057], zoom: 17}));
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['transport-stops']}).length)).toBeGreaterThan(0);
  await expect(page.locator('#transport-status')).toHaveText(/internet connection/);
  await tapMapCenter(page,[19.254951,42.446057]);
  await expect(page.locator('#place-category')).toHaveText('Bus stop');
  await page.getByRole('button',{name:'From',exact:true}).click();
  await expect(page.locator('#route-from')).toContainText('Ul. 13. jula (B)');
  const busNetwork=JSON.parse(fs.readFileSync(new URL('../../../../data/sources/transit-network.json', import.meta.url)));
  const pattern=busNetwork.patterns.find(p=>p.offsets.at(-1)>0);
  await tapMapCenter(page,busNetwork.stops[pattern.stops[0]].coordinates);
  await page.getByRole('button',{name:'From',exact:true}).click();
  await tapMapCenter(page,busNetwork.stops[pattern.stops.at(-1)].coordinates);
  await page.getByRole('button',{name:'To',exact:true}).click();
  await expect(page.locator('#route-status')).toContainText('internet connection');
  await page.getByRole('button',{name:'Public transport',exact:true}).click();
  await expect(page.locator('#route-status')).toHaveAttribute('data-state','ready');
  await expect(page.locator('#route-status')).toContainText('+ waiting');
  const numbered=JSON.parse(fs.readFileSync(new URL('../../../../data/sources/building-labels.geojson', import.meta.url))).features[0];
  await page.evaluate(c=>window.kompasDebug.map.jumpTo({center:c,zoom:20}),numbered.geometry.coordinates);
  await expect.poll(()=>page.evaluate(id=>window.kompasDebug.map.queryRenderedFeatures({layers:['building-numbers']}).some(f=>f.properties.osm_id===id),numbered.id)).toBe(true);
  await page.evaluate(()=>window.kompasDebug.map.setLayoutProperty('building-numbers','visibility','none'));
  await tapMapCenter(page,[19.26539,42.43437]);
  await expect(page.locator('#place-name')).toHaveText('Building 105,107');
  await expect(page.locator('#place-details')).toContainText('Oktobarske revolucije 105,107');
  await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.queryRenderedFeatures({layers:['selected-buildings-fill']}).some(f=>f.id===71))).toBe(true);
  expect(errors).toEqual([]);
});

test.describe('server mode', () => {
  // The service worker forwards same-origin /api requests itself, out of reach of request routing;
  // it never caches them, so blocking it here changes nothing the test checks.
  test.use({serviceWorkers: 'block'});
  test('config.json selects server mode: layers and vehicles come from the Kompas API', async ({page, baseURL}) => {
    const requests = [];
    const tileJSON = {
      tilejson: '3.0.0',
      scheme: 'xyz',
      minzoom: 0,
      maxzoom: 16,
      bounds: [17.8, 41.3, 21, 44.1],
      tiles: [new URL('api/v1/layers/test-0123456789abcdef/tiles/{z}/{x}/{y}.mvt', baseURL).href],
      vector_layers: []
    };
    await page.route('**/api/v1/layers', route => {
      requests.push('layers');
      return route.fulfill({json: tileJSON});
    });
    await page.route('**/api/v1/layers/test-0123456789abcdef/tiles/**', route => {
      requests.push('tile');
      return route.fulfill({status: 204});
    });
    await page.route('**/api/v1/transport/vehicles', route => {
      requests.push('vehicles');
      return route.fulfill({json: {type: 'FeatureCollection', fetchedAt: new Date().toISOString(), stale: false, source: 'https://epodgorica.me/javniprevoz/mapa',
        features: [{type: 'Feature', geometry: {type: 'Point', coordinates: [19.26, 42.44]}, properties: {route: '6A', bearing: 90, heading: 'movement'}}]}});
    });
    await page.route('https://cg-map-transit-relay.arcane-pond-2083.chatgpt.site/api/vehicles', route => {
      requests.push('relay');
      return route.abort();
    });
    // The host's config.json alone selects server mode, as the Go server does.
    await page.route('**/config.json', route => route.fulfill({json: {api: 'server'}}));
    await page.goto('./');
    await page.waitForFunction(() => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('search-place'));
    expect(await page.evaluate(() => window.kompasDebug.dataMode)).toBe('server');
    await expect.poll(() => requests.includes('tile')).toBe(true);
    await openMenu(page);
    await page.getByRole('button', {name: 'Transport', exact: true}).click();
    await expect(page.locator('#transport-status')).toHaveText(/1 bus position · checked/);
    expect(requests).toContain('layers');
    expect(requests).toContain('vehicles');
    expect(requests).not.toContain('relay');
    // The server's movement bearing is drawn as a solid arrow, rotated as reported.
    await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.26, 42.44], zoom: 15}));
    await expect.poll(() => page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['transport-buses']}).map(f => [f.properties.heading, f.properties.bearing]))).toEqual([['movement', 90]]);
  });
});

test('server mode switches the basemap to an offline download made during the session', async ({page}) => {
  await page.goto('./?api=server');
  await page.waitForFunction(() => window.kompasDebug?.map?.getLayer('search-place'));
  expect(await page.evaluate(() => window.kompasDebug.map.getSource('basemap').url)).toMatch(/\/api\/v1\/layers$/);
  await openMenu(page);
  await expect(page.locator('#download')).toBeEnabled();
  await page.locator('#download').click();
  await page.waitForFunction(() => window.kompasDebug.offline, null, {timeout: 60000});
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getSource('basemap').url)).toMatch(/^pmtiles:\/\/.*\.pmtiles$/);
  await page.locator('#remove-download').click();
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getSource('basemap').url)).toMatch(/\/api\/v1\/layers$/);
});

test('a failed places request names the failure and keeps the map usable', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({status: 500, body: 'no'}));
  await page.goto('./');
  await page.waitForFunction(() => window.kompasDebug?.map?.getLayer('search-place'));
  await expect(page.locator('#error-text')).toContainText('Places could not load');
  await expect(page.locator('#loading')).toBeHidden();
  // Not presented as an empty search result, before or after moving the map.
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.25, 42.44], zoom: 16}));
  await expect(page.locator('#results')).toContainText('Places could not load');
  await expect(page.locator('#results')).not.toContainText('No places found');
  expect(await page.evaluate(() => window.kompasDebug.map.getLayer('buildings') !== undefined)).toBe(true);
  await openMenu(page);
  expect(await page.evaluate(() => {
    const notice=document.getElementById('error').getBoundingClientRect();
    const dock=document.querySelector('.sidebar').getBoundingClientRect();
    const x=Math.min(notice.left+4,dock.right-4);
    return !!document.elementFromPoint(x,notice.top+4)?.closest('#error');
  })).toBe(true);
  await page.getByRole('button', {name: 'Dismiss notice', exact: true}).click();
  await expect(page.locator('#error')).toBeHidden();
  await expect(page.locator('#search')).toBeFocused();
});
