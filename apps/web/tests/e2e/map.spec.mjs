import {test, expect} from '@playwright/test';
import fs from 'node:fs';
test.beforeEach(async ({page}) => {
  await page.route('https://routing.openstreetmap.de/**', route => route.fulfill({status:503,json:{code:'Unavailable'}}));
});
const fixture = JSON.parse(fs.readFileSync(new URL('../../../../data/tests/fixtures/podgorica-places.geojson', import.meta.url)));
async function openMenu(page) {
  if (await page.locator('#menu-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#menu-toggle').click();
}
async function closeMenu(page) {
  if (await page.locator('#menu-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#menu-toggle').click();
  else if (await page.locator('body').getAttribute('data-view') === 'search') await page.keyboard.press('Escape');
}
// Phones have no visible cross: activate the button the way a screen reader does.
async function closeCard(page) {
  const phone = page.viewportSize().width <= 720;
  if (phone) await page.locator('#close-place').dispatchEvent('click');
  else await page.locator('#close-place').click();
}
const camera = page => page.evaluate(() => {
  const map = window.kompasDebug.map;
  return {center: map.getCenter().toArray(), zoom: map.getZoom()};
});
async function settled(page) {
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
}
async function pointOnMap(page, coordinates) {
  return page.evaluate(lngLat => {
    const point = window.kompasDebug.map.project(lngLat);
    return {x: point.x, y: point.y};
  }, coordinates);
}
async function ready(page) {
  await page.goto('./');
  await expect(page).not.toHaveURL(/\/web\//);
  await page.waitForFunction(() => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('place-symbols'));
  await expect(page.locator('#loading')).toBeHidden();
}

test('map, fixture search, selection, and satellite preserve the map instance', async ({page, isMobile}) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
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
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await ready(page);
  await openMenu(page);
  await expect(page.locator('#download')).toBeEnabled();
  await page.locator('#download').click();
  await page.waitForFunction(() => window.kompasDebug.offline, null, {timeout: 60000});
  await expect(page.locator('#download-state')).toHaveText('READY');
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => window.kompasDebug?.offline && window.kompasDebug.map.getLayer('place-symbols'));
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

test('old /web/ bookmarks open the root app and preserve query/hash', async ({page, baseURL}) => {
  await page.goto(new URL('web/?lang=sr#place', baseURL).href);
  await expect(page).toHaveURL(new URL('?lang=sr#place', baseURL).href);
  await page.waitForFunction(() => window.kompasDebug?.map?.getLayer('place-symbols'));
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
  await openMenu(page);
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await expect(page.locator('#transport-status')).toHaveText(/1 bus position · checked/);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getSource('transport')._data.features.length)).toBe(1);
  // Static hosts use the bundled archive and the hosted relay.
  expect(await page.evaluate(() => [window.kompasDebug.dataMode, window.kompasDebug.map.getStyle().sources.basemap.url.startsWith('pmtiles://')])).toEqual(['mock', true]);
  // A bus that has not moved yet points along its route; the icon carries the arrow.
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['transport-buses']}).map(f => f.properties.heading))).toEqual(['route']);
  expect(await page.evaluate(() => window.kompasDebug.map.hasImage('bus-arrow'))).toBe(true);
  expect(await page.evaluate(original => original === window.kompasDebug.map, map)).toBe(true);
  await openMenu(page);
  await page.getByRole('button', {name: 'Satellite', exact: true}).click();
  await expect(page.locator('#transport-toggle')).toHaveAttribute('aria-pressed', 'true');
  await context.setOffline(true);
  await expect(page.locator('#transport-status')).toHaveText(/internet connection/);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getSource('transport')._data.features.length)).toBe(0);
  await openMenu(page);
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await expect(page.locator('#transport-info')).toBeHidden();
});

test.describe('server mode', () => {
  // The service worker forwards same-origin /api requests itself, out of reach of request routing;
  // it never caches them, so blocking it here changes nothing the test checks.
  test.use({serviceWorkers: 'block'});
  test('config.json selects server mode: layers and vehicles come from the Kompas API', async ({page, baseURL}) => {
    const requests = [];
    await page.route('**/api/v1/layers', route => {requests.push('layers');return route.fulfill({json: {tilejson: '3.0.0', scheme: 'xyz', minzoom: 0, maxzoom: 16, bounds: [17.8, 41.3, 21, 44.1], tiles: [new URL('api/v1/layers/test-0123456789abcdef/tiles/{z}/{x}/{y}.mvt', baseURL).href], vector_layers: []}});});
    await page.route('**/api/v1/layers/test-0123456789abcdef/tiles/**', route => {requests.push('tile');return route.fulfill({status: 204});});
    await page.route('**/api/v1/transport/vehicles', route => {
      requests.push('vehicles');
      return route.fulfill({json: {type: 'FeatureCollection', fetchedAt: new Date().toISOString(), stale: false, source: 'https://epodgorica.me/javniprevoz/mapa',
        features: [{type: 'Feature', geometry: {type: 'Point', coordinates: [19.26, 42.44]}, properties: {route: '6A', bearing: 90, heading: 'movement'}}]}});
    });
    await page.route('https://cg-map-transit-relay.arcane-pond-2083.chatgpt.site/api/vehicles', route => {requests.push('relay');return route.abort();});
    // The host's config.json alone selects server mode, as the Go server does.
    await page.route('**/config.json', route => route.fulfill({json: {api: 'server'}}));
    await page.goto('./');
    await page.waitForFunction(() => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('place-symbols'));
    expect(await page.evaluate(() => window.kompasDebug.dataMode)).toBe('server');
    await expect.poll(() => requests.includes('tile')).toBe(true);
    await openMenu(page);
    await page.getByRole('button', {name: 'Transport', exact: true}).click();
    await expect(page.locator('#transport-status')).toHaveText(/1 bus position · checked/);
    expect(requests).toContain('layers'); expect(requests).toContain('vehicles'); expect(requests).not.toContain('relay');
    // The server's movement bearing is drawn as a solid arrow, rotated as reported.
    await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.26, 42.44], zoom: 15}));
    await expect.poll(() => page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['transport-buses']}).map(f => [f.properties.heading, f.properties.bearing]))).toEqual([['movement', 90]]);
  });
});

test('server mode switches the basemap to an offline download made during the session', async ({page}) => {
  await page.goto('./?api=server');
  await page.waitForFunction(() => window.kompasDebug?.map?.getLayer('place-symbols'));
  expect(await page.evaluate(() => window.kompasDebug.map.getSource('basemap').url)).toMatch(/\/api\/v1\/layers$/);
  await openMenu(page);
  await expect(page.locator('#download')).toBeEnabled();
  await page.locator('#download').click();
  await page.waitForFunction(() => window.kompasDebug.offline, null, {timeout: 60000});
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getSource('basemap').url)).toMatch(/^pmtiles:\/\/.*\.pmtiles$/);
  await page.locator('#remove-download').click();
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getSource('basemap').url)).toMatch(/\/api\/v1\/layers$/);
});

test('transport failure is visible and does not break the map', async ({page}) => {
  await page.route('https://cg-map-transit-relay.arcane-pond-2083.chatgpt.site/api/vehicles', route => route.fulfill({status: 503, json: {error: 'unavailable'}}));
  await ready(page);
  await openMenu(page);
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await expect(page.locator('#transport-status')).toHaveText(/temporarily unavailable/);
  expect(await page.evaluate(() => !!window.kompasDebug.map.getLayer('place-symbols'))).toBe(true);
});

test('stop snapshot renders and selects independently of live bus availability', async ({page}) => {
  await page.route('https://cg-map-transit-relay.arcane-pond-2083.chatgpt.site/api/vehicles', route => route.fulfill({status: 503, json: {error: 'unavailable'}}));
  await ready(page);
  expect(await page.evaluate(() => window.kompasDebug.map.getLayoutProperty('transport-stops', 'visibility'))).toBe('none');
  await openMenu(page);
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await expect(page.locator('#transport-status')).toHaveText(/temporarily unavailable/);
  await closeMenu(page);
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.254951, 42.446057], zoom: 17}));
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['transport-stops']}).length)).toBeGreaterThan(0);
  const point = await page.evaluate(() => {
    const map = window.kompasDebug.map, p = map.project([19.254951, 42.446057]), box = map.getCanvas().getBoundingClientRect();
    return {x: box.left + p.x, y: box.top + p.y};
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#place-card')).toContainText('Ul. 13. jula (B)');
  await expect(page.locator('#place-card')).toContainText('Stop ID: 1');
  expect(await page.evaluate(()=>window.kompasDebug.map.getFeatureState({source:'transport-stops',id:'1'}).selected)).toBe(true);
  await openMenu(page);
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await expect(page.locator('#place-card')).toBeHidden();
  expect(await page.evaluate(()=>window.kompasDebug.map.getFeatureState({source:'transport-stops',id:'1'}).selected)).toBe(false);
  expect(await page.evaluate(() => window.kompasDebug.map.getLayoutProperty('transport-stops', 'visibility'))).toBe('none');
});

// Place symbols are collision-placed below addresses and road names (Discover D-05), so a place is tapped where its
// symbol is actually drawn, zooming in until there is room for it.
async function tapRenderedPlace(page, coordinates, id) {
  await closeMenu(page);
  let point=null;
  for(const zoom of [17,18,19,20,21]) {
    await page.evaluate(({coordinates,zoom})=>window.kompasDebug.map.jumpTo({center:coordinates,zoom}),{coordinates,zoom});
    await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.areTilesLoaded())).toBe(true);
    await page.waitForTimeout(100);
    point=await page.evaluate(({coordinates,id})=>{
      const m=window.kompasDebug.map;
      if(!m.queryRenderedFeatures({layers:['place-symbols']}).some(f=>f.id===id))return null;
      const p=m.project(coordinates),b=m.getCanvas().getBoundingClientRect();
      return {x:b.left+p.x,y:b.top+p.y};
    },{coordinates,id});
    if(point)break;
  }
  expect(point).not.toBeNull();
  await page.mouse.click(point.x,point.y);
}

async function tapMapCenter(page, coordinates) {
  await closeMenu(page);
  await page.evaluate(point => window.kompasDebug.map.jumpTo({center: point, zoom: 17}), coordinates);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  const point = await page.evaluate(() => {
    const m=window.kompasDebug.map, p=m.project(m.getCenter()), b=m.getCanvas().getBoundingClientRect();
    return {x:b.left+p.x,y:b.top+p.y};
  });
  await page.mouse.click(point.x,point.y);
}

test('map points offer From/To, preserve both endpoints, and clear them', async ({page}) => {
  await ready(page);
  await tapMapCenter(page,[20.8,43.7]);
  await expect(page.locator('#place-name')).toHaveText('Map point');
  await expect(page.getByRole('button',{name:'From',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'From',exact:true}).click();
  await expect(page.locator('#place-card')).toBeHidden();
  await expect(page.locator('#route-from')).toContainText('43.70000, 20.80000');
  await tapMapCenter(page,[20.81,43.71]);
  await page.getByRole('button',{name:'To',exact:true}).click();
  await expect(page.locator('#route-to')).toContainText('43.71000, 20.81000');
  expect(await page.evaluate(()=>window.kompasDebug.map.getSource('route-points')._data.features.length)).toBe(2);
  await tapMapCenter(page,[20.8,43.7]);
  await expect(page.locator('#place-category')).toHaveText('From point');
  await page.getByRole('button',{name:'To',exact:true}).click();
  await expect(page.locator('#route-to')).toContainText('43.70000, 20.80000');
  const viewport = page.viewportSize();
  for (const width of [720, 721, 768]) {
    await page.setViewportSize({width, height: 840});
    const header = await page.locator('.search-bar').boundingBox();
    const route = await page.locator('#route-endpoints').boundingBox();
    expect(route.y).toBeGreaterThanOrEqual(header.y + header.height);
  }
  await page.setViewportSize(viewport);
  await page.getByRole('button',{name:'Clear points',exact:true}).click();
  await expect(page.locator('#route-endpoints')).toBeHidden();
  expect(await page.evaluate(()=>window.kompasDebug.map.getSource('route-points')._data.features.length)).toBe(0);
});

test('building selection provides feature details and point actions', async ({page}) => {
  await ready(page);
  await page.evaluate(()=>window.kompasDebug.map.jumpTo({center:[19.26,42.437],zoom:17}));
  await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.queryRenderedFeatures({layers:['buildings']}).length)).toBeGreaterThan(0);
  // Pick from final-zoom geometry; overzoomed parent tiles shift building edges when they are replaced.
  await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.areTilesLoaded())).toBe(true);
  const picked=await page.evaluate(()=>{
    const m=window.kompasDebug.map, b=m.getCanvas().getBoundingClientRect();
    // Find a visible building interior away from controls and place markers.
    for(let y=150;y<b.height-65;y+=8)for(let x=b.width*.5;x<b.width-65;x+=8){
      const hits=m.queryRenderedFeatures([x,y],{layers:['buildings','place-symbols']});
      if(hits.some(f=>f.layer.id==='buildings')&&!hits.some(f=>f.layer.id!=='buildings'))return {x:b.left+x,y:b.top+y,id:hits.find(f=>f.layer.id==='buildings').id};
    }
    return null;
  });
  expect(picked).not.toBeNull();await page.mouse.click(picked.x,picked.y);
  await expect(page.locator('#place-category')).toHaveText('Building');
  await expect(page.locator('#place-details')).toContainText('Type: building');
  await expect(page.getByRole('button',{name:'To',exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(id=>{
    const m=window.kompasDebug.map;
    const fill=m.queryRenderedFeatures({layers:['selected-buildings-fill']});
    const outline=m.queryRenderedFeatures({layers:['selected-buildings-outline']});
    return fill.length>0&&outline.length>0&&[...fill,...outline].every(f=>f.id===id);
  },picked.id)).toBe(true);
  expect(await page.evaluate(()=>!!window.kompasDebug.map.getLayer('selected-halo'))).toBe(false);
  await closeCard(page);
  await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.queryRenderedFeatures({layers:['selected-buildings-fill','selected-buildings-outline']}).length)).toBe(0);
});

test.describe('isolated routing provider checks',()=>{
 test.use({serviceWorkers:'block'});
 // These tests deliberately make offline setup unavailable. Acknowledge its recoverable notice before routing.
 async function readyForRouting(page) {
  await ready(page);
  await expect(page.locator('#error-text')).toContainText('Offline setup failed:');
  await page.getByRole('button',{name:'Dismiss notice',exact:true}).click();
  await expect(page.locator('#error')).toBeHidden();
 }
test('route modes draw different street routes and a bus itinerary; clearing removes the line', async ({page}) => {
  const calls=[];
  await page.route('https://routing.openstreetmap.de/**', route => {
    const walking=route.request().url().includes('routed-foot');calls.push(walking?'walk':'car');
    return route.fulfill({json:{code:'Ok',routes:[{distance:walking?850:1200,duration:walking?650:180,geometry:{type:'LineString',coordinates:[[19.254951,42.446057],[19.26,42.445],[19.26345,42.443523]]},legs:[{steps:[{distance:850,name:'Test street',maneuver:{type:'depart'}}]}]}]}});
  });
  await page.route('**/data/transit-network.json', route => route.fulfill({json:{version:1,retrievedAt:'2026-10-18T19:00:00Z',stops:{a:{name:'Start stop',coordinates:[19.254951,42.446057]},b:{name:'End stop',coordinates:[19.26345,42.443523]}},patterns:[{route:'6',name:'Test bus',headsign:'End stop',stops:['a','b'],offsets:[0,600]}]}}));
  await readyForRouting(page);
  await tapMapCenter(page,[19.254951,42.446057]);await page.getByRole('button',{name:'From',exact:true}).click();
  await tapMapCenter(page,[19.26345,42.443523]);await page.getByRole('button',{name:'To',exact:true}).click();
  await expect(page.locator('#route-status')).toHaveText('3 min · 1.2 km');
  await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.getSource('planned-route')._data.features.length)).toBe(1);
  await page.getByRole('button',{name:'Walk',exact:true}).click();
  await expect(page.locator('#route-status')).toHaveText('11 min · 850 m');
  expect(calls).toContain('walk');expect(calls).toContain('car');
  await page.getByRole('button',{name:'Public transport',exact:true}).click();
  await expect(page.locator('#route-status')).toHaveText(/10 min \+ waiting/);
  await page.locator('#route-itinerary summary').click();
  await expect(page.locator('#route-steps')).toContainText('Bus 6');
  await expect(page.locator('#route-note')).toContainText('Check departures');
  await page.getByRole('button',{name:'Clear points',exact:true}).click();
  expect(await page.evaluate(()=>window.kompasDebug.map.getSource('planned-route')._data.features.length)).toBe(0);
});

test('route errors and identical endpoints stay explicit without leaving old lines', async ({page}) => {
  await readyForRouting(page);
  await tapMapCenter(page,[20.8,43.7]);await page.getByRole('button',{name:'From',exact:true}).click();
  await tapMapCenter(page,[20.8,43.7]);await page.getByRole('button',{name:'To',exact:true}).click();
  await expect(page.locator('#route-status')).toContainText('same point');
  await tapMapCenter(page,[20.81,43.71]);await page.getByRole('button',{name:'To',exact:true}).click();
  await expect(page.locator('#route-status')).toContainText('unavailable');
  expect(await page.evaluate(()=>window.kompasDebug.map.getSource('planned-route')._data.features.length)).toBe(0);
  await expect(page.locator('#route-retry')).toBeVisible();
});

});

test('single tap opens point actions after a delay; double tap zooms without opening them', async ({page,isMobile}) => {
  await ready(page);
  await page.evaluate(()=>window.kompasDebug.map.jumpTo({center:[20.8,43.7],zoom:14}));
  // Programmatic camera movement also cancels pending point actions.
  await page.waitForTimeout(550);
  const p=await page.evaluate(()=>{const b=window.kompasDebug.map.getCanvas().getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};});
  if(isMobile)await page.touchscreen.tap(p.x,p.y);else await page.mouse.click(p.x,p.y);
  await expect(page.locator('#place-card')).toBeHidden();
  await expect(page.locator('#place-card')).toBeVisible();
  await expect(page.locator('#point-from')).toBeVisible();
  await closeCard(page);
  const zoom=await page.evaluate(()=>window.kompasDebug.map.getZoom());
  if(isMobile){await page.touchscreen.tap(p.x,p.y);await page.touchscreen.tap(p.x,p.y);}else await page.mouse.dblclick(p.x,p.y);
  await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.getZoom())).toBeGreaterThan(zoom+.2);
  await page.waitForTimeout(650);
  await expect(page.locator('#place-card')).toBeHidden();
});

test('one-finger tap then drag zooms and never opens point actions', async ({page,context,isMobile}) => {
  test.skip(!isMobile,'Native mobile touch gesture');
  await ready(page);
  await page.evaluate(()=>window.kompasDebug.map.jumpTo({center:[20.8,43.7],zoom:14}));
  await page.waitForTimeout(550);
  const p=await page.evaluate(()=>{const b=window.kompasDebug.map.getCanvas().getBoundingClientRect();return {x:b.left+b.width/2,y:b.top+b.height/2};});
  const zoom=await page.evaluate(()=>window.kompasDebug.map.getZoom());
  const cdp=await context.newCDPSession(page);
  const touch=(type,y=p.y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x:p.x,y,id:7}]});
  await touch('touchStart');await touch('touchEnd');
  await page.waitForTimeout(60);
  await touch('touchStart');
  for(const dy of [15,35,60,90]){await touch('touchMove',p.y+dy);await page.waitForTimeout(25);}
  await touch('touchEnd');
  await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.getZoom())).toBeGreaterThan(zoom+.2);
  await page.waitForTimeout(650);
  await expect(page.locator('#place-card')).toBeHidden();
  expect(await page.evaluate(()=>window.kompasDebug.endpoints)).toEqual({from:null,to:null});
});

test('building house numbers start at the 100m scale and open address details', async ({page}) => {
  const labels=JSON.parse(fs.readFileSync(new URL('../../../../data/sources/building-labels.geojson', import.meta.url)));
  const places=JSON.parse(fs.readFileSync(new URL('../../../../data/sources/places.geojson', import.meta.url)));
  const label=labels.features.find(f=>!places.features.some(p=>Math.hypot(p.geometry.coordinates[0]-f.geometry.coordinates[0],p.geometry.coordinates[1]-f.geometry.coordinates[1])<.00005));
  expect(label).toBeTruthy();
  await ready(page);
  await page.evaluate(c=>window.kompasDebug.map.jumpTo({center:c,zoom:14.5}),label.geometry.coordinates);
  expect(await page.evaluate(()=>window.kompasDebug.map.queryRenderedFeatures({layers:['building-numbers']}).length)).toBe(0);
  await expect(page.locator('.maplibregl-ctrl-scale')).toHaveText('200 m');
  await page.evaluate(c=>window.kompasDebug.map.jumpTo({center:c,zoom:15}),label.geometry.coordinates);
  await expect(page.locator('.maplibregl-ctrl-scale')).toHaveText('100 m');
  await expect.poll(()=>page.evaluate(id=>window.kompasDebug.map.queryRenderedFeatures({layers:['building-numbers']}).some(f=>f.properties.osm_id===id),label.id)).toBe(true);
  const point=await page.evaluate(c=>{const m=window.kompasDebug.map,p=m.project(c),b=m.getCanvas().getBoundingClientRect();return {x:b.left+p.x,y:b.top+p.y};},label.geometry.coordinates);
  await page.mouse.click(point.x,point.y);
  await expect(page.locator('#place-category')).toHaveText('Building');
  await expect(page.locator('#place-name')).toHaveText('Building '+label.properties['addr:housenumber']);
  await expect(page.locator('#point-from')).toBeVisible();
});


test('same building keeps its address across zooms and with number labels hidden', async ({page}) => {
  await ready(page);
  // Reproduce the building and off-label tap location in the reported screenshots.
  const coordinates=[19.26539,42.43437];
  for(const zoom of [15,17,19,20]) {
    await page.evaluate(({coordinates,zoom})=>{
      const m=window.kompasDebug.map;m.jumpTo({center:coordinates,zoom});
      m.setLayoutProperty('building-numbers','visibility','none');
    },{coordinates,zoom});
    await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.areTilesLoaded())).toBe(true);
    const point=await page.evaluate(c=>{const m=window.kompasDebug.map,p=m.project(c),b=m.getCanvas().getBoundingClientRect();return {x:b.left+p.x,y:b.top+p.y};},coordinates);
    await page.mouse.click(point.x,point.y);
    await expect(page.locator('#place-category')).toHaveText('Building');
    await expect(page.locator('#place-name')).toHaveText('Building 105,107');
    await expect(page.locator('#place-details')).toContainText('Oktobarske revolucije 105,107');
    await closeCard(page);
  }
});


test('a place inside a building highlights its footprint across zoom and satellite changes',async({page})=>{
  const label=JSON.parse(fs.readFileSync(new URL('../../../../data/sources/building-labels.geojson', import.meta.url))).features.find(f=>{const [x,y]=f.geometry.coordinates;return x>19.251&&x<19.261&&y>42.438&&y<42.445;});
  const coordinates=label.geometry.coordinates,footprintId=label.properties.footprintIndex;
  await page.route('**/data/places.geojson',route=>route.fulfill({json:{type:'FeatureCollection',features:[{
    type:'Feature',geometry:{type:'Point',coordinates},properties:{id:'node/selection-fixture',name:'Building cafe',category:'food',kind:'cafe'}
  }]}}));
  await ready(page);
  await openMenu(page);
  await page.getByRole('button',{name:'Satellite',exact:true}).click();
  await page.evaluate(c=>window.kompasDebug.map.jumpTo({center:c,zoom:8}),coordinates);
  await openMenu(page);
  await page.locator('.result').first().click();
  await expect(page.locator('#place-name')).toHaveText('Building cafe');
  for(const zoom of [15,17,20]){
    await page.evaluate(({coordinates,zoom})=>window.kompasDebug.map.jumpTo({center:coordinates,zoom}),{coordinates,zoom});
    await expect.poll(()=>page.evaluate(id=>{
      const m=window.kompasDebug.map;
      const features=m.queryRenderedFeatures({layers:['selected-buildings-fill','selected-buildings-outline']});
      return features.length>0&&features.every(f=>f.id===id);
    },footprintId)).toBe(true);
  }
  await expect.poll(()=>page.evaluate(id=>window.kompasDebug.map.queryRenderedFeatures({layers:['selected-buildings-fill']}).some(f=>f.id===id),footprintId)).toBe(true);
  expect(await page.evaluate(()=>window.kompasDebug.map.getStyle().layers.filter(l=>l.id.startsWith('selected-')).map(l=>l.type).every(t=>t==='fill'||t==='line'))).toBe(true);
});

test('point-only places highlight their existing markers and restore them on close',async({page})=>{
  await ready(page);
  const places=JSON.parse(fs.readFileSync(new URL('../../../../data/sources/places.geojson', import.meta.url))).features;
  for(const sourceId of ['node/13719099734','node/309892487']) {
    const index=places.findIndex(f=>f.properties.id===sourceId),place=places[index];
    await tapRenderedPlace(page,place.geometry.coordinates,index+1);
    await expect(page.locator('#place-name')).toHaveText(place.properties.name);
    await expect.poll(()=>page.evaluate(id=>window.kompasDebug.map.getFeatureState({source:'places',id}).selected,index+1)).toBe(true);
    expect(await page.evaluate(()=>window.kompasDebug.map.queryRenderedFeatures({layers:['selected-buildings-fill']}).length)).toBe(0);
    expect(await page.evaluate(()=>window.kompasDebug.map.getSource('point-selection')._data.features.length)).toBe(0);
    await closeCard(page);
    expect(await page.evaluate(id=>window.kompasDebug.map.getFeatureState({source:'places',id}).selected,index+1)).toBe(false);
  }
  await tapMapCenter(page,[20.8,43.7]);
  await expect(page.locator('#place-category')).toHaveText('Map point');
  await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.getSource('point-selection')._data.features.length)).toBe(1);
  await closeCard(page);
  expect(await page.evaluate(()=>window.kompasDebug.map.getSource('point-selection')._data.features.length)).toBe(0);
});

test.describe('Discover first view', () => {
  test.use({permissions: ['geolocation'], geolocation: {latitude: 42.4411, longitude: 19.2627, accuracy: 18}});
  test('granted location shows marker, accuracy and status and centers once without a click', async ({page}) => {
    await ready(page);
    await expect(page.locator('#position-status')).toHaveText(/You are here · ±18 m/);
    await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getSource('position')._data.features.map(f => f.properties.part))).toEqual(['accuracy', 'position']);
    await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getCenter().distanceTo({lng: 19.2627, lat: 42.4411}))).toBeLessThan(5);
    await expect(page.locator('#position-action')).toHaveAttribute('aria-label', /Recenter on your location/);
    await expect(page.locator('#position-action')).toBeVisible();
    // The location is never written to browser storage.
    expect(await page.evaluate(() => JSON.stringify({...localStorage}) + JSON.stringify({...sessionStorage}))).not.toContain('42.441');
    await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.25, 42.43], zoom: 16}));
    await page.locator('#position-action').click();
    await expect(page.locator('#place-card')).toBeHidden();
    await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getCenter().distanceTo({lng: 19.2627, lat: 42.4411}))).toBeLessThan(150);
  });
});

test('without location the status says so and the default view is labelled as a fallback', async ({page}) => {
  await ready(page);
  await expect(page.locator('#position-status')).toHaveText(/(blocked|Allow location|Finding).*default view: Podgorica/);
  expect(await page.evaluate(() => window.kompasDebug.map.getSource('position')._data.features.length)).toBe(0);
});

test('first view is at street scale with minimal controls, house numbers and no Plan prompt', async ({page}) => {
  await ready(page);
  const mpp = await page.evaluate(() => {
    const m = window.kompasDebug.map, c = m.getContainer();
    return m.unproject([c.clientWidth / 2 - 50, c.clientHeight / 2]).distanceTo(m.unproject([c.clientWidth / 2 + 50, c.clientHeight / 2])) / 100;
  });
  expect(mpp).toBeGreaterThan(0.8); expect(mpp).toBeLessThan(1.2);
  await expect(page.locator('#dock-content')).toBeHidden();
  await expect(page.locator('#search-bubble')).toBeHidden();
  await expect(page.locator('#menu-toggle')).toBeVisible();
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#position-action')).toBeVisible();
  await expect(page.locator('#map-key, #overview, #podgorica, .intro, .map-note')).toHaveCount(0);
  await expect(page.locator('#position-status')).toHaveClass('sr-only');
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['building-numbers']}).length)).toBeGreaterThan(0);
});

test('country scale draws no ordinary places or count clusters; street scale brings them back', async ({page}) => {
  await ready(page);
  await page.evaluate(() => window.kompasDebug.map.fitBounds([[18.42,41.84],[20.36,43.57]], {padding:55,duration:0}));
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.getZoom())).toBeLessThan(9);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  expect(await page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['place-symbols']}).length)).toBe(0);
  expect(await page.evaluate(() => window.kompasDebug.map.getStyle().layers.some(l => l.id === 'clusters'))).toBe(false);
  // District scale: only sights and essentials.
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.2627, 42.4411], zoom: 13.5}));
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['place-symbols']}).length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => [...new Set(window.kompasDebug.map.queryRenderedFeatures({layers: ['place-symbols']}).map(f => f.properties.category))].every(c => ['sights', 'essentials'].includes(c)))).toBe(true);
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.2627, 42.4411], zoom: 16}));
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['place-symbols']}).length)).toBeGreaterThan(0);
  // The directory is unchanged by scale suppression.
  expect(await page.evaluate(() => window.kompasDebug.placeCount)).toBeGreaterThan(1000);
});

test('footways, steps and cycleways have their own layers', async ({page}) => {
  await ready(page);
  const ids = await page.evaluate(() => window.kompasDebug.map.getStyle().layers.map(l => l.id));
  for (const id of ['footways', 'paths', 'cycleways', 'steps']) expect(ids).toContain(id);
});

test('a failed places request names the failure and keeps the map usable', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({status: 500, body: 'no'}));
  await page.goto('./');
  await page.waitForFunction(() => window.kompasDebug?.map?.getLayer('place-symbols'));
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

test('dock expands around a stationary header and keeps layer/download options anchored', async ({page}, testInfo) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
  await ready(page);
  const header = await page.locator('.search-bar').boundingBox();
  const burger = await page.locator('#menu-toggle').boundingBox();
  const search = await page.locator('#search').boundingBox();
  const locate = await page.locator('#position-action').boundingBox();
  const zoom = await page.getByRole('button', {name: 'Zoom in', exact: true}).boundingBox();
  expect(locate.y + locate.height).toBeLessThanOrEqual(zoom.y);
  await page.screenshot({path: testInfo.outputPath('opening.png')});
  await openMenu(page);
  expect(await page.locator('.search-bar').boundingBox()).toEqual(header);
  expect(await page.locator('#menu-toggle').boundingBox()).toEqual(burger);
  expect(await page.locator('#search').boundingBox()).toEqual(search);
  await expect(page.locator('.layer-tile')).toHaveCount(2);
  await expect(page.locator('#download-title')).toHaveText('Download for offline use');
  await expect(page.getByRole('heading', {name: /Map layers|Offline map/})).toHaveCount(0);
  await expect(page.locator('#toggle-results, #reset')).toHaveCount(0);
  const footer = await page.locator('.dock-footer').boundingBox();
  await page.locator('#categories').getByRole('button', {name: 'Eat & drink', exact: true}).click();
  await expect(page.locator('.result')).toHaveCount(0);
  expect(await page.locator('.dock-footer').boundingBox()).toEqual(footer);
  await page.locator('#categories').getByRole('button', {name: 'Eat & drink', exact: true}).click();
  await expect(page.locator('#categories').getByRole('button', {name: 'Explore all', exact: true})).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.result')).toHaveCount(3);
  expect(await page.locator('.dock-footer').boundingBox()).toEqual(footer);
  await page.screenshot({path: testInfo.outputPath('dock.png')});
  await closeMenu(page);
  expect(await page.locator('.search-bar').boundingBox()).toEqual(header);
  expect(await page.locator('#menu-toggle').boundingBox()).toEqual(burger);
  expect(await page.locator('#search').boundingBox()).toEqual(search);
});

test('search keeps phone categories fixed above scrolling results and shows a chosen result beside them', async ({page, isMobile}, testInfo) => {
  const places = {type: 'FeatureCollection', features: Array.from({length: 30}, (_, i) => ({
    type: 'Feature', geometry: {type: 'Point', coordinates: [19.26 + i * .00002, 42.44]},
    properties: {id: 'search/' + i, name: 'Mobile result ' + String(i).padStart(2, '0'), category: 'shops', kind: 'shop'}
  }))};
  await page.route('**/data/places.geojson', route => route.fulfill({json: places}));
  await ready(page);
  const header = await page.locator('.search-bar').boundingBox();
  await page.locator('#search').fill('Mobile result');
  await expect(page.locator('.result')).toHaveCount(30);
  await expect(page.locator('body')).toHaveAttribute('data-view', isMobile ? 'search' : 'dock');
  if (isMobile) {
    await expect(page.locator('#dock-content')).toBeHidden();
    await expect(page.locator('.dock-footer')).toBeHidden();
    const bubble = await page.locator('#search-bubble').boundingBox();
    expect(bubble.height).toBeLessThanOrEqual(420);
    expect(bubble.y + bubble.height).toBe(420);
    const row = await page.locator('.result').first().boundingBox();
    expect(row.height).toBeGreaterThanOrEqual(76);
    const list = await page.locator('#results').boundingBox();
    expect(list.height).toBeGreaterThan(250);
  }
  expect(await page.locator('.search-bar').boundingBox()).toEqual(header);
  await settled(page);
  const categories = await page.locator('#categories').boundingBox();
  await page.locator('#results').evaluate(element => { element.scrollTop = 250; });
  await expect.poll(() => page.locator('#results').evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  expect(await page.locator('#categories').boundingBox()).toEqual(categories);
  await page.screenshot({path: testInfo.outputPath('search.png')});
  if (isMobile) {
    await page.evaluate(() => {
      const viewport = new EventTarget();
      Object.assign(viewport, {height: 420, offsetTop: 0});
      Object.defineProperty(window, 'visualViewport', {configurable: true, value: viewport});
      window.dispatchEvent(new Event('resize'));
    });
    await expect.poll(() => page.locator('#search-bubble').evaluate(element => element.getBoundingClientRect().height)).toBeLessThanOrEqual(210);
    const bubble = await page.locator('#search-bubble').boundingBox();
    expect(bubble.y + bubble.height).toBe(210);
    expect(await page.locator('#categories').boundingBox()).toEqual(categories);
    await page.screenshot({path: testInfo.outputPath('search-keyboard.png')});
  }
  await page.locator('#search').fill('Mobile result 07');
  await expect(page.locator('.result')).toHaveCount(1);
  await openMenu(page);
  await expect(page.locator('#dock-content')).toBeVisible();
  await expect(page.locator('#search-bubble')).toBeHidden();
  await expect(page.locator('#search')).toHaveValue('Mobile result 07');
  await closeMenu(page);
  await page.locator('#search').click();
  await page.locator('.result').click();
  await expect(page.locator('#place-name')).toHaveText('Mobile result 07');
  await expect(page.locator('.result')).toBeVisible();
  // Choosing a result dismisses the keyboard simulated above; the place is judged in the layout that leaves.
  if (isMobile) await simulateKeyboard(page, 840);
  await expect.poll(async () => {
    const point = await pointOnMap(page, places.features[7].geometry.coordinates);
    const card = await page.locator('#place-card').boundingBox();
    if (!isMobile) return point.x > card.x + card.width;
    const bubble = await page.locator('#search-bubble').boundingBox();
    return point.y > bubble.y + bubble.height && point.y < card.y - 8;
  }).toBe(true);
});

const nearbyPlaces = {type: 'FeatureCollection', features: Array.from({length: 6}, (_, i) => ({
  type: 'Feature', geometry: {type: 'Point', coordinates: [19.26 + i * .004, 42.44]},
  properties: {id: 'nearby/' + i, name: 'Nearby place ' + i, category: i % 2 ? 'food' : 'shops', kind: 'shop'}
}))};

test('opening search, typing, and choosing a category leave the map still', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.3, 42.5], zoom: 16}));
  const before = await camera(page);
  await page.locator('#search').click();
  await page.locator('#categories').getByRole('button', {name: 'Eat & drink', exact: true}).click();
  await expect(page.locator('.result')).toHaveCount(3);
  await page.locator('#search').fill('Nearby place 3');
  await expect(page.locator('.result')).toHaveCount(1);
  await page.waitForTimeout(600);
  expect(await camera(page)).toEqual(before);
});

test('choosing a result moves the map only when the result is outside the focus zone', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  const target = nearbyPlaces.features[0].geometry.coordinates;
  await page.evaluate(lngLat => window.kompasDebug.map.jumpTo({center: [lngLat[0] + .02, lngLat[1] + .01], zoom: 16}), target);
  await page.locator('#search').click();
  const row = page.locator('.result', {hasText: 'Nearby place 0'});
  const outside = await camera(page);
  await row.click();
  await expect.poll(async () => (await camera(page)).center).not.toEqual(outside.center);
  await settled(page);
  const revealed = await camera(page);
  expect(revealed.zoom).toBe(16);
  await closeCard(page);
  await expect(page.locator('#place-card')).toBeHidden();
  await row.click();
  await expect(page.locator('#place-card')).toBeVisible();
  await page.waitForTimeout(600);
  expect(await camera(page)).toEqual(revealed);
});

test('a chosen result still zooms in to street level from far out', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.26, 42.44], zoom: 11}));
  await page.locator('#search').click();
  await page.locator('.result', {hasText: 'Nearby place 0'}).click();
  await expect.poll(async () => (await camera(page)).zoom).toBe(15);
});

test('search bar focus has no ring, and categories and the place card have no scrollbars', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  const barBorder = () => page.locator('.search-bar').evaluate(element => getComputedStyle(element).borderColor);
  const resting = await barBorder();
  await page.locator('#search').focus();
  expect(await page.locator('#search').evaluate(element => getComputedStyle(element).outlineStyle)).toBe('none');
  expect(await barBorder()).not.toBe(resting);
  await page.locator('.result').first().click();
  for (const selector of ['#categories', '#place-card'])
    expect(await page.locator(selector).evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe('none');
});

test('desktop keeps the dock and results open beside the place card', async ({page, isMobile}, testInfo) => {
  test.skip(isMobile, 'desktop layout');
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await page.locator('#search').click();
  const row = page.locator('.result', {hasText: 'Nearby place 0'});
  await row.click();
  await expect(page.locator('#place-card')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
  await expect(row).toHaveAttribute('aria-current', 'true');
  await settled(page);
  const dock = await page.locator('.sidebar').boundingBox();
  const card = await page.locator('#place-card').boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(dock.x + dock.width);
  const place = await pointOnMap(page, nearbyPlaces.features[0].geometry.coordinates);
  expect(place.x).toBeGreaterThan(card.x + card.width);
  await page.screenshot({path: testInfo.outputPath('desktop-results-card.png')});
  await page.locator('#close-place').click();
  await expect(page.locator('#place-card')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
  await expect(row).toBeFocused();
});

test('phone place card peeks under results and swipes through full and closed', async ({page, isMobile}, testInfo) => {
  test.skip(!isMobile, 'phone layout');
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  const touch = await page.context().newCDPSession(page);
  const swipe = async (deltaY, selector = '#place-card') => {
    const start = await page.locator(selector).boundingBox();
    const x = start.x + start.width / 2, y = start.y + 30;
    await touch.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
    for (let step = 1; step <= 5; step++)
      await touch.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x, y: y + deltaY * step / 5}]});
    await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
  };
  const card = page.locator('#place-card');
  const cardSettled = async state => {
    await expect(card).toHaveAttribute('data-state', state);
    await expect.poll(() => card.evaluate(element => element.getAnimations().length)).toBe(0);
  };
  await page.locator('#search').click();
  await page.locator('#categories').getByRole('button', {name: 'Shops', exact: true}).click();
  // Read in the click's own task: the card must open as a peek, not shrink down from full height.
  const opening = await page.locator('.result', {hasText: 'Nearby place 0'}).evaluate(row => {
    row.click();
    const element = document.getElementById('place-card');
    return {height: element.getBoundingClientRect().height, animations: element.getAnimations().length};
  });
  expect(opening.animations).toBe(0);
  expect(opening.height).toBeLessThan(100);

  await cardSettled('peek');
  await expect(page.locator('#search-bubble')).toBeVisible();
  await expect(page.locator('#results-strip')).toBeHidden();
  const peek = await card.boundingBox();
  expect(peek.height).toBeLessThan(100);
  await expect(page.locator('#place-body')).toHaveJSProperty('inert', true);
  const clippedBody = await page.locator('#place-body').boundingBox();
  // Allows the 1px border and sub-pixel text layout.
  expect(clippedBody.y).toBeGreaterThanOrEqual(peek.y + peek.height - 2);
  const closeBox = await page.locator('#close-place').boundingBox();
  expect(closeBox.width).toBeLessThanOrEqual(1);
  await page.screenshot({path: testInfo.outputPath('phone-peek.png')});

  await swipe(-160);
  await cardSettled('full');
  await expect(page.locator('#search-bubble')).toBeHidden();
  await expect(page.locator('#results-strip')).toBeVisible();
  await expect(page.locator('#results-strip-label')).toHaveText('Shops');
  await expect(page.locator('#point-from')).toBeVisible();
  await settled(page);
  const place = await pointOnMap(page, nearbyPlaces.features[0].geometry.coordinates);
  const strip = await page.locator('#results-strip').boundingBox();
  const full = await card.boundingBox();
  expect(place.y).toBeGreaterThan(strip.y + strip.height);
  expect(place.y).toBeLessThan(full.y);
  await page.screenshot({path: testInfo.outputPath('phone-full.png')});

  await page.locator('#results-strip').click();
  await cardSettled('peek');
  await expect(page.locator('#search-bubble')).toBeVisible();
  await page.locator('#card-handle').click();
  await cardSettled('full');

  // A short full card also swipes from its body, not only the header.
  await swipe(120, '#place-details');
  await cardSettled('peek');
  await expect(page.locator('#search-bubble')).toBeVisible();
  await swipe(60);
  await expect(card).toBeHidden();
  await expect(page.locator('#search-bubble')).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'search');

  // With no search behind it, one swipe closes the card.
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await tapRenderedPlace(page, nearbyPlaces.features[0].geometry.coordinates, 1);
  await cardSettled('full');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  // The handle has nothing to fold down to here.
  await page.locator('#card-handle').click();
  await expect(card).toHaveAttribute('data-state', 'full');
  await swipe(120);
  await expect(card).toBeHidden();
});

test('phone search stays in the dock or compact view it started from until a result is chosen', async ({page, isMobile}) => {
  test.skip(!isMobile, 'phone layout');
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  const body = page.locator('body');
  const dock = page.locator('#dock-content');
  const bubble = page.locator('#search-bubble');

  // Compact stays compact while searching.
  await page.locator('#search').click();
  await expect(body).toHaveAttribute('data-view', 'search');
  await page.locator('#search').fill('Nearby');
  await expect(body).toHaveAttribute('data-view', 'search');
  await expect(dock).toBeHidden();
  await page.locator('#search').fill('');
  await page.keyboard.press('Escape');
  await expect(body).toHaveAttribute('data-view', 'closed');

  // The dock stays open through focus, typing, and categories, with results inside it.
  await openMenu(page);
  await page.locator('#search').click();
  await expect(body).toHaveAttribute('data-view', 'dock');
  await page.locator('#search').fill('Nearby');
  await page.locator('#categories').getByRole('button', {name: 'Shops', exact: true}).click();
  await expect(body).toHaveAttribute('data-view', 'dock');
  await expect(dock).toBeVisible();
  await expect(bubble).toBeHidden();
  await expect(page.locator('#dock-main .result')).toHaveCount(3);

  // Only a result click moves to compact, with the same minimized card and the query and category kept.
  await page.locator('.result', {hasText: 'Nearby place 0'}).click();
  await expect(body).toHaveAttribute('data-view', 'search');
  await expect(dock).toBeHidden();
  await expect(bubble).toBeVisible();
  await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'peek');
  await expect(page.locator('#search')).toHaveValue('Nearby');
  await expect(page.locator('#categories').getByRole('button', {name: 'Shops', exact: true})).toHaveAttribute('aria-pressed', 'true');
});

test('phone dock results end above the keyboard, and its options return when it closes', async ({page, isMobile}) => {
  test.skip(!isMobile, 'phone layout');
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await openMenu(page);
  await expect(page.locator('.dock-footer')).toBeVisible();
  await page.locator('#search').click();
  await simulateKeyboard(page, 420);
  await expect(page.locator('.dock-footer')).toBeHidden();
  await expect.poll(async () => {
    const results = await page.locator('#results').boundingBox();
    return results.y + results.height;
  }).toBeLessThanOrEqual(420);
  // A panned visual viewport carries the header, so the dock content must follow it.
  await simulateKeyboard(page, 420, 1, 40);
  await expect.poll(async () => {
    const header = await page.locator('.search-bar').boundingBox();
    const categories = await page.locator('#categories').boundingBox();
    return categories.y >= header.y + header.height;
  }).toBe(true);
  await simulateKeyboard(page, 840);
  await expect(page.locator('.dock-footer')).toBeVisible();
});

const simulateKeyboard = (page, height, scale = 1, offsetTop = 0) => page.evaluate(({visibleHeight, pageScale, pageOffset}) => {
  const viewport = new EventTarget();
  Object.assign(viewport, {height: visibleHeight, offsetTop: pageOffset, scale: pageScale});
  Object.defineProperty(window, 'visualViewport', {configurable: true, value: viewport});
  window.dispatchEvent(new Event('resize'));
}, {visibleHeight: height, pageScale: scale, pageOffset: offsetTop});

test('phone keyboard: the focus zone is judged after it closes, and the map stays still while it is open', async ({page, isMobile}) => {
  test.skip(!isMobile, 'phone layout');
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  const place = nearbyPlaces.features[0].geometry.coordinates;
  await page.evaluate(lngLat => window.kompasDebug.map.jumpTo({center: lngLat, zoom: 16}), place);
  await page.locator('#search').click();
  const row = page.locator('.result', {hasText: 'Nearby place 0'});

  // First choice with no keyboard puts the place in the resting zone.
  await row.click();
  await expect(page.locator('#place-card')).toBeVisible();
  await settled(page);
  await page.waitForTimeout(500);
  const resting = await camera(page);
  await closeCard(page);

  // With the keyboard up, the same place would be outside the shrunken zone; the camera must not react to that.
  await simulateKeyboard(page, 420);
  await row.click();
  await expect(page.locator('#place-card')).toBeVisible();
  await simulateKeyboard(page, 840);
  await page.waitForTimeout(700);
  expect(await camera(page)).toEqual(resting);

  // A keyboard raised over an open card leaves the camera still, and closing it leaves the place uncovered.
  await simulateKeyboard(page, 420);
  await page.waitForTimeout(300);
  expect(await camera(page)).toEqual(resting);
  await simulateKeyboard(page, 840);
  await page.waitForTimeout(300);
  const point = await pointOnMap(page, place);
  const bubble = await page.locator('#search-bubble').boundingBox();
  const card = await page.locator('#place-card').boundingBox();
  expect(point.y).toBeGreaterThan(bubble.y + bubble.height);
  expect(point.y).toBeLessThan(card.y);
});

test('a small visual viewport without a phone keyboard does not hold the camera back', async ({page, isMobile}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  const place = nearbyPlaces.features[0].geometry.coordinates;
  await page.evaluate(lngLat => window.kompasDebug.map.jumpTo({center: [lngLat[0] + .02, lngLat[1] + .01], zoom: 16}), place);
  await page.locator('#search').click();
  // A pinch-zoomed phone page, or a desktop window's visual viewport: neither is a keyboard.
  await simulateKeyboard(page, 420, isMobile ? 1.5 : 1);
  const before = await camera(page);
  await page.locator('.result', {hasText: 'Nearby place 0'}).click();
  await expect.poll(async () => (await camera(page)).center).not.toEqual(before.center);
});

test('the result list keeps its order while a chosen place is open and re-sorts after', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  const lastPlace = nearbyPlaces.features[5].geometry.coordinates;
  await page.evaluate(lngLat => window.kompasDebug.map.jumpTo({center: lngLat, zoom: 16}), lastPlace);
  await page.locator('#search').click();
  const names = page.locator('.result strong');
  await expect(names.first()).toHaveText('Nearby place 5');
  const order = await names.allTextContents();

  // The far row is outside the zone, so the map travels to the other end of the list.
  await page.locator('.result', {hasText: 'Nearby place 0'}).click();
  await expect.poll(async () => (await camera(page)).center[0]).toBeLessThan(lastPlace[0] - .01);
  await settled(page);
  await page.waitForTimeout(200);
  expect(await names.allTextContents()).toEqual(order);

  await closeCard(page);
  await page.evaluate(() => window.kompasDebug.map.panBy([1, 0], {duration: 0}));
  await expect(names.first()).toHaveText('Nearby place 0');
});

test('search highlights the nearest match on the map without moving it', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  const nearest = nearbyPlaces.features[3];
  await page.evaluate(lngLat => window.kompasDebug.map.jumpTo({center: lngLat, zoom: 16}), nearest.geometry.coordinates);
  const before = await camera(page);
  await page.locator('#search').fill('Nearby');
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['search-place']})[0]?.properties.name)).toBe(nearest.properties.name);
  expect(await camera(page)).toEqual(before);
});

test('choosing a route point from a result shows the route controls', async ({page, isMobile}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await page.locator('#search').click();
  await page.locator('.result', {hasText: 'Nearby place 0'}).click();
  await expect(page.locator('#place-card')).toBeVisible();
  if (isMobile) await page.locator('#card-handle').click();
  await page.locator('#point-from').click();
  await expect(page.locator('#place-card')).toBeHidden();
  await expect(page.locator('#route-endpoints')).toBeVisible();
  await expect(page.locator('#route-from')).toContainText('Nearby place 0');
});

test('a tapped map pin follows the focus zone like a result', async ({page, isMobile}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  const place = nearbyPlaces.features[0].geometry.coordinates;
  const firstFeatureId = 1;

  // The helper centres the map on the pin, which is inside the zone with the card open: no move.
  await tapRenderedPlace(page, place, firstFeatureId);
  await expect(page.locator('#place-name')).toHaveText('Nearby place 0');
  await page.waitForTimeout(600);
  const inZone = await camera(page);
  expect(inZone.center[0]).toBeCloseTo(place[0], 6);
  expect(inZone.center[1]).toBeCloseTo(place[1], 6);
  await closeCard(page);
  await expect(page.locator('#place-card')).toBeHidden();

  // Pushed to the right edge of the uncovered map, the same pin is outside the zone: the map moves.
  const pushRight = isMobile ? -114 : -540;
  await page.evaluate(x => window.kompasDebug.map.panBy([x, 0], {duration: 0}), pushRight);
  await settled(page);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  const before = await camera(page);
  const pin = await pointOnMap(page, place);
  if (isMobile) await page.touchscreen.tap(pin.x, pin.y);
  else await page.mouse.click(pin.x, pin.y);
  await expect(page.locator('#place-card')).toBeVisible();
  await expect.poll(async () => (await camera(page)).center).not.toEqual(before.center);
  await settled(page);
  const moved = await pointOnMap(page, place);
  expect(moved.x).toBeLessThan(pin.x);
});

test('phone category strip scrolls to the active chip and with a mouse wheel', async ({page, isMobile}) => {
  test.skip(!isMobile, 'phone layout');
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await page.locator('#search').click();
  const strip = page.locator('#categories');
  const chip = name => strip.getByRole('button', {name, exact: true});
  const chipInStrip = async name => {
    const box = await chip(name).boundingBox();
    const stripBox = await strip.boundingBox();
    return box.x >= stripBox.x - 1 && box.x + box.width <= stripBox.x + stripBox.width + 1;
  };
  expect(await chipInStrip('Essentials')).toBe(false);
  // A plain DOM click: Playwright's own click would scroll the chip into view and hide a failure.
  await chip('Essentials').evaluate(element => element.click());
  await expect.poll(() => chipInStrip('Essentials')).toBe(true);
  await chip('Essentials').evaluate(element => element.click());
  await expect(chip('Explore all')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => chipInStrip('Explore all')).toBe(true);

  const scrolled = await strip.evaluate(element => {
    const start = element.scrollLeft;
    element.dispatchEvent(new WheelEvent('wheel', {deltaY: 60, bubbles: true, cancelable: true}));
    return element.scrollLeft - start;
  });
  expect(scrolled).toBeGreaterThan(0);
});

test('one wheel gesture changes the phone card state only once', async ({page, isMobile}) => {
  test.skip(!isMobile, 'phone layout');
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await page.locator('#search').click();
  await page.locator('.result', {hasText: 'Nearby place 0'}).click();
  const card = page.locator('#place-card');
  await expect(card).toHaveAttribute('data-state', 'peek');
  const wheelBurst = deltaY => card.evaluate((element, delta) => {
    for (let event = 0; event < 6; event++) element.dispatchEvent(new WheelEvent('wheel', {deltaY: delta, bubbles: true, cancelable: true}));
  }, deltaY);
  await wheelBurst(40);
  await expect(card).toHaveAttribute('data-state', 'full');
  await page.waitForTimeout(650);
  await wheelBurst(-40);
  await expect(card).toHaveAttribute('data-state', 'peek');
  await page.waitForTimeout(650);
  await wheelBurst(-40);
  await expect(card).toBeHidden();
});

test('a narrow desktop window narrows the card and keeps the map controls reachable', async ({page, isMobile}) => {
  test.skip(isMobile, 'desktop layout');
  await page.setViewportSize({width: 780, height: 700});
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await page.locator('#search').click();
  await page.locator('.result').first().click();
  const dock = await page.locator('.sidebar').boundingBox();
  const card = await page.locator('#place-card').boundingBox();
  const locate = await page.locator('#position-action').boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(dock.x + dock.width);
  expect(card.width).toBeLessThan(375);
  expect(card.x + card.width).toBeLessThanOrEqual(locate.x);
});
