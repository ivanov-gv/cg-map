import {test, expect} from '@playwright/test';
import fs from 'node:fs';
test.beforeEach(async ({page}) => {
  await page.route('https://routing.openstreetmap.de/**', route => route.fulfill({status:503,json:{code:'Unavailable'}}));
});
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
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.254951, 42.446057], zoom: 17}));
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['transport-stops']}).length)).toBeGreaterThan(0);
  await expect(page.locator('#transport-status')).toHaveText(/internet connection/);
  await tapMapCenter(page,[19.254951,42.446057]);
  await expect(page.locator('#place-category')).toHaveText('Bus stop');
  await page.getByRole('button',{name:'From',exact:true}).click();
  await expect(page.locator('#route-from')).toContainText('Ul. 13. jula (B)');
  const busNetwork=JSON.parse(fs.readFileSync('data/sources/transit-network.json'));
  const pattern=busNetwork.patterns.find(p=>p.offsets.at(-1)>0);
  await tapMapCenter(page,busNetwork.stops[pattern.stops[0]].coordinates);
  await page.getByRole('button',{name:'From',exact:true}).click();
  await tapMapCenter(page,busNetwork.stops[pattern.stops.at(-1)].coordinates);
  await page.getByRole('button',{name:'To',exact:true}).click();
  await expect(page.locator('#route-status')).toContainText('internet connection');
  await page.getByRole('button',{name:'Public transport',exact:true}).click();
  await expect(page.locator('#route-status')).toHaveAttribute('data-state','ready');
  await expect(page.locator('#route-status')).toContainText('+ waiting');
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

test('stop snapshot renders and selects independently of live bus availability', async ({page}) => {
  await page.route('https://cg-map-transit-relay.arcane-pond-2083.chatgpt.site/api/vehicles', route => route.fulfill({status: 503, json: {error: 'unavailable'}}));
  await ready(page);
  expect(await page.evaluate(() => window.kompasDebug.map.getLayoutProperty('transport-stops', 'visibility'))).toBe('none');
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await expect(page.locator('#transport-status')).toHaveText(/temporarily unavailable/);
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.254951, 42.446057], zoom: 17}));
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.queryRenderedFeatures({layers: ['transport-stops']}).length)).toBeGreaterThan(0);
  const point = await page.evaluate(() => {
    const map = window.kompasDebug.map, p = map.project([19.254951, 42.446057]), box = map.getCanvas().getBoundingClientRect();
    return {x: box.left + p.x, y: box.top + p.y};
  });
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#place-card')).toContainText('Ul. 13. jula (B)');
  await expect(page.locator('#place-card')).toContainText('Stop ID: 1');
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await expect(page.locator('#place-card')).toBeHidden();
  expect(await page.evaluate(() => window.kompasDebug.map.getLayoutProperty('transport-stops', 'visibility'))).toBe('none');
});

async function tapMapCenter(page, coordinates) {
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
  await page.getByRole('button',{name:'Clear points',exact:true}).click();
  await expect(page.locator('#route-endpoints')).toBeHidden();
  expect(await page.evaluate(()=>window.kompasDebug.map.getSource('route-points')._data.features.length)).toBe(0);
});

test('building selection provides feature details and point actions', async ({page}) => {
  await ready(page);
  await page.evaluate(()=>window.kompasDebug.map.jumpTo({center:[19.26,42.437],zoom:17}));
  await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.queryRenderedFeatures({layers:['buildings']}).length)).toBeGreaterThan(0);
  const picked=await page.evaluate(()=>{
    const m=window.kompasDebug.map, b=m.getCanvas().getBoundingClientRect();
    // Find a visible building interior away from controls and place markers.
    for(let y=150;y<b.height-65;y+=8)for(let x=b.width*.5;x<b.width-65;x+=8){
      const hits=m.queryRenderedFeatures([x,y],{layers:['buildings','place-circles','place-names']});
      if(hits.some(f=>f.layer.id==='buildings')&&!hits.some(f=>f.layer.id!=='buildings'))return {x:b.left+x,y:b.top+y};
    }
    return null;
  });
  expect(picked).not.toBeNull();await page.mouse.click(picked.x,picked.y);
  await expect(page.locator('#place-category')).toHaveText('Building');
  await expect(page.locator('#place-details')).toContainText('Type: building');
  await expect(page.getByRole('button',{name:'To',exact:true})).toBeVisible();
});

test.describe('isolated routing provider checks',()=>{
 test.use({serviceWorkers:'block'});
test('route modes draw different street routes and a bus itinerary; clearing removes the line', async ({page}) => {
  const calls=[];
  await page.route('https://routing.openstreetmap.de/**', route => {
    const walking=route.request().url().includes('routed-foot');calls.push(walking?'walk':'car');
    return route.fulfill({json:{code:'Ok',routes:[{distance:walking?850:1200,duration:walking?650:180,geometry:{type:'LineString',coordinates:[[19.254951,42.446057],[19.26,42.445],[19.26345,42.443523]]},legs:[{steps:[{distance:850,name:'Test street',maneuver:{type:'depart'}}]}]}]}});
  });
  await page.route('**/data/transit-network.json', route => route.fulfill({json:{version:1,retrievedAt:'2026-10-18T19:00:00Z',stops:{a:{name:'Start stop',coordinates:[19.254951,42.446057]},b:{name:'End stop',coordinates:[19.26345,42.443523]}},patterns:[{route:'6',name:'Test bus',headsign:'End stop',stops:['a','b'],offsets:[0,600]}]}}));
  await ready(page);
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
  await ready(page);
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
  await page.locator('#close-place').click();
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
