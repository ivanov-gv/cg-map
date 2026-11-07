// Shared by the browser specs. Each spec covers one area, which CI runs as its own job.
import {expect} from '@playwright/test';
import fs from 'node:fs';

// No test may reach the real routing provider.
export const stubRouting = page => page.route('https://routing.openstreetmap.de/**', route => route.fulfill({status:503,json:{code:'Unavailable'}}));

export const fixture = JSON.parse(fs.readFileSync(new URL('../../../../data/tests/fixtures/podgorica-places.geojson', import.meta.url)));
// Every layer that can draw a place marker, in the current stable-level design.
export const PLACE_ICON_LAYERS = `window.kompasDebug.map.getStyle().layers.map(l => l.id).filter(id => id.startsWith('place-icons-'))`;
export const renderedPlaceIcons = page => page.evaluate(`window.kompasDebug.map.queryRenderedFeatures({layers: ${PLACE_ICON_LAYERS}}).map(f => ({id: f.id, category: f.properties.category, level: f.properties.visibilityLevel}))`);
export async function openMenu(page) {
  if (await page.locator('#menu-toggle').getAttribute('aria-expanded') !== 'true') await page.locator('#menu-toggle').click();
}
export async function closeMenu(page) {
  if (await page.locator('#menu-toggle').getAttribute('aria-expanded') === 'true') await page.locator('#menu-toggle').click();
  else if (await page.locator('body').getAttribute('data-view') === 'search') await page.keyboard.press('Escape');
}
// Phones have no visible cross: activate the button the way a screen reader does.
export async function closeCard(page) {
  const phone = page.viewportSize().width <= 720;
  if (phone) await page.locator('#close-place').dispatchEvent('click');
  else await page.locator('#close-place').click();
}
export const camera = page => page.evaluate(() => {
  const map = window.kompasDebug.map;
  return {center: map.getCenter().toArray(), zoom: map.getZoom()};
});
export async function settled(page) {
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.isMoving())).toBe(false);
}
export async function pointOnMap(page, coordinates) {
  return page.evaluate(lngLat => {
    const point = window.kompasDebug.map.project(lngLat);
    return {x: point.x, y: point.y};
  }, coordinates);
}
// Where coordinates are drawn, in page pixels, for mouse and touch input.
export async function screenPoint(page, coordinates) {
  return page.evaluate(lngLat => {
    const map = window.kompasDebug.map;
    const point = map.project(lngLat);
    const canvas = map.getCanvas().getBoundingClientRect();
    return {x: canvas.left + point.x, y: canvas.top + point.y};
  }, coordinates);
}
// The middle of the map canvas, in page pixels.
export async function mapCenterOnScreen(page) {
  return page.evaluate(() => {
    const canvas = window.kompasDebug.map.getCanvas().getBoundingClientRect();
    return {x: canvas.left + canvas.width / 2, y: canvas.top + canvas.height / 2};
  });
}
export async function ready(page) {
  await page.goto('./');
  await expect(page).not.toHaveURL(/\/web\//);
  await page.waitForFunction(() => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('search-place'));
  await expect(page.locator('#loading')).toBeHidden();
}
// A place is tapped where its icon is drawn: icons are always placed once a place reaches its level's zoom.
export async function tapRenderedPlace(page, coordinates, id) {
  await closeMenu(page);
  let point=null;
  for(const zoom of [17,18,19,20,21]) {
    await page.evaluate(({coordinates,zoom})=>window.kompasDebug.map.jumpTo({center:coordinates,zoom}),{coordinates,zoom});
    await expect.poll(()=>page.evaluate(()=>window.kompasDebug.map.areTilesLoaded())).toBe(true);
    await page.waitForTimeout(100);
    point=await page.evaluate(({coordinates,id})=>{
      const m=window.kompasDebug.map;
      const layers=m.getStyle().layers.map(l=>l.id).filter(layer=>layer.startsWith('place-icons-'));
      if(!m.queryRenderedFeatures({layers}).some(f=>f.id===id))return null;
      const p=m.project(coordinates),b=m.getCanvas().getBoundingClientRect();
      return {x:b.left+p.x,y:b.top+p.y};
    },{coordinates,id});
    if(point)break;
  }
  expect(point).not.toBeNull();
  await page.mouse.click(point.x,point.y);
}
export async function tapMapCenter(page, coordinates) {
  await closeMenu(page);
  await page.evaluate(point => window.kompasDebug.map.jumpTo({center: point, zoom: 17}), coordinates);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  const center = await page.evaluate(() => window.kompasDebug.map.getCenter().toArray());
  const point = await screenPoint(page, center);
  await page.mouse.click(point.x, point.y);
}
export const nearbyPlaces = {type: 'FeatureCollection', features: Array.from({length: 6}, (_, i) => ({
  type: 'Feature', geometry: {type: 'Point', coordinates: [19.26 + i * .004, 42.44]},
  properties: {id: 'nearby/' + i, name: 'Nearby place ' + i, category: i % 2 ? 'food' : 'shops', kind: 'shop'}
}))};
export const simulateKeyboard = (page, height, scale = 1, offsetTop = 0) => page.evaluate(({visibleHeight, pageScale, pageOffset}) => {
  const viewport = new EventTarget();
  Object.assign(viewport, {height: visibleHeight, offsetTop: pageOffset, scale: pageScale});
  Object.defineProperty(window, 'visualViewport', {configurable: true, value: viewport});
  window.dispatchEvent(new Event('resize'));
}, {visibleHeight: height, pageScale: scale, pageOffset: offsetTop});
