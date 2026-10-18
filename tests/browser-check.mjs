// Optional real-browser functional check. Not executed in the build environment.
// Install Playwright separately, start the supplied server, then:
// KOMPAS_URL=http://localhost:8080 node tests/browser-check.mjs
import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const {chromium}=await import('playwright');
const browser=await chromium.launch();await fs.mkdir('qa-output',{recursive:true});
try{
 for(const [name,viewport,isMobile] of [['desktop',{width:1280,height:800},false],['mobile',{width:412,height:840},true]]){
  const context=await browser.newContext({viewport,isMobile,hasTouch:isMobile,serviceWorkers:'allow'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.KOMPAS_URL??'http://localhost:8080/');await page.waitForFunction(()=>window.kompasDebug?.map?.isStyleLoaded()&&window.kompasDebug.map.getLayer('place-circles'),null,{timeout:60000});
  await page.locator('#loading').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.kompasDebug.placeCount),1811);
  if(isMobile)await page.locator('#toggle-results').click();await page.locator('.result').first().click();await page.locator('#place-card').waitFor({state:'visible'});await page.locator('#close-place').click();await page.locator('#place-card').waitFor({state:'hidden'});
  await page.locator('#search').fill('museum');await page.waitForTimeout(200);await page.locator('#reset').click();
  await page.evaluate(()=>window.kompasDebug.map.jumpTo({zoom:21}));await page.waitForFunction(()=>window.kompasDebug.map.areTilesLoaded());assert.ok(await page.evaluate(()=>window.kompasDebug.map.getZoom()>20));
  await page.setViewportSize({width:viewport.height,height:viewport.width});await page.waitForTimeout(250);assert.ok(await page.evaluate(()=>Math.abs(window.kompasDebug.map.getCanvas().getBoundingClientRect().width-document.getElementById('map').getBoundingClientRect().width)<2));
  await page.screenshot({path:`qa-output/${name}-close-zoom.png`});
  await page.locator('#download').click();await page.waitForFunction(()=>window.kompasDebug.offline,null,{timeout:120000});await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.kompasDebug?.offline&&window.kompasDebug.map.getLayer('place-circles'),null,{timeout:60000});await page.screenshot({path:`qa-output/${name}-offline.png`});
  assert.deepEqual(errors,[]);await context.close();console.log(name,'functional checks passed');
 }
}finally{await browser.close();}
