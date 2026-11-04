import {test, expect} from '@playwright/test';
import fs from 'node:fs';
import {closeCard, closeMenu, openMenu, ready, stubRouting, tapMapCenter, tapRenderedPlace} from './helpers.mjs';

test.beforeEach(({page}) => stubRouting(page));

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

test('transport failure is visible and does not break the map', async ({page}) => {
  await page.route('https://cg-map-transit-relay.arcane-pond-2083.chatgpt.site/api/vehicles', route => route.fulfill({status: 503, json: {error: 'unavailable'}}));
  await ready(page);
  await openMenu(page);
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await expect(page.locator('#transport-status')).toHaveText(/temporarily unavailable/);
  expect(await page.evaluate(() => !!window.kompasDebug.map.getLayer('search-place'))).toBe(true);
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
      const hits=m.queryRenderedFeatures([x,y],{layers:['buildings',...m.getStyle().layers.map(l=>l.id).filter(layer=>/^place-(icons|names)-/.test(layer))]});
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
    const place=places.find(f=>f.properties.id===sourceId);
    await tapRenderedPlace(page,place.geometry.coordinates,sourceId);
    await expect(page.locator('#place-name')).toHaveText(place.properties.name);
    await expect.poll(()=>page.evaluate(id=>window.kompasDebug.map.getFeatureState({source:'places',id}).selected,sourceId)).toBe(true);
    expect(await page.evaluate(()=>window.kompasDebug.map.queryRenderedFeatures({layers:['selected-buildings-fill']}).length)).toBe(0);
    expect(await page.evaluate(()=>window.kompasDebug.map.getSource('point-selection')._data.features.length)).toBe(0);
    await closeCard(page);
    expect(await page.evaluate(id=>window.kompasDebug.map.getFeatureState({source:'places',id}).selected,sourceId)).toBe(false);
  }
  await tapMapCenter(page,[20.8,43.7]);
  await expect(page.locator('#place-category')).toHaveText('Map point');
  await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.getSource('point-selection')._data.features.length)).toBe(1);
  await closeCard(page);
  expect(await page.evaluate(()=>window.kompasDebug.map.getSource('point-selection')._data.features.length)).toBe(0);
});
