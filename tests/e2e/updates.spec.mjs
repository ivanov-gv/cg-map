import {test,expect} from '@playwright/test';
import {startUpdateServer} from './update-server.mjs';

test('new release reloads all tabs once, bypasses HTTP cache, and preserves a failed/offline release',async({page,context,baseURL})=>{
 const scope=new URL(baseURL).pathname;
 const host=await startUpdateServer(scope);
 try{
  // Speed up the actual production timer without replacing worker behavior.
  await context.addInitScript(()=>{
   const interval=window.setInterval.bind(window);
   window.setInterval=(fn,ms,...args)=>interval(fn,ms===60_000?500:ms,...args);
  });
  const url=host.url+'?lang=sr#point';
  await page.goto(url);
  await page.waitForFunction(()=>navigator.serviceWorker.controller&&window.registration);
  await expect(page.locator('#version')).toHaveText('1');
  expect(await page.evaluate(()=>sessionStorage.loads)).toBe('1');
  const other=await context.newPage();await other.goto(url);
  await other.waitForFunction(()=>navigator.serviceWorker.controller&&window.registration);
  host.release(2,true);
  await expect.poll(()=>host.failures).toBeGreaterThan(0);
  await expect(page.locator('#version')).toHaveText('1');
  expect(await page.evaluate(()=>sessionStorage.loads)).toBe('1');
  expect(await page.evaluate(()=>fetch('version.txt').then(r=>r.text()))).toBe('1');
  host.release(2);
  for(const tab of [page,other]){
   await expect(tab.locator('#version')).toHaveText('2');
   await expect(tab).toHaveURL(url);
   expect(await tab.evaluate(()=>sessionStorage.loads)).toBe('2');
  }
  await page.waitForTimeout(1800);
  for(const tab of [page,other])expect(await tab.evaluate(()=>sessionStorage.loads)).toBe('2');
  await context.setOffline(true);await page.reload();
  await expect(page.locator('#version')).toHaveText('2');
  expect(await page.evaluate(()=>fetch('version.txt').then(r=>r.text()))).toBe('2');
 }finally{await host.close();}
});
