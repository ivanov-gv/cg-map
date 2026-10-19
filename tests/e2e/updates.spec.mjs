import {test,expect} from '@playwright/test';
import {startUpdateServer} from './update-server.mjs';

test('page reload checks for a release without background polling and preserves offline use',async({page,context,baseURL})=>{
 const scope=new URL(baseURL).pathname;
 const host=await startUpdateServer(scope);
 try{
  const url=host.url+'?lang=sr#point';
  await page.goto(url);
  await page.waitForFunction(()=>navigator.serviceWorker.controller&&window.registration);
  await expect(page.locator('#version')).toHaveText('1');
  expect(await page.evaluate(()=>sessionStorage.loads)).toBe('1');
  const other=await context.newPage();await other.goto(url);
  await other.waitForFunction(()=>navigator.serviceWorker.controller&&window.registration);
  // Finish the initial load checks before publishing the next fixture release.
  await other.evaluate(()=>window.registration.update());
  host.release(2,true);
  await page.evaluate(()=>{
   window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('pageshow'));
   document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1100);
  expect(host.failures).toBe(0);
  await page.reload();
  await expect.poll(()=>host.failures).toBeGreaterThan(0);
  await expect(page.locator('#version')).toHaveText('1');
  expect(await page.evaluate(()=>sessionStorage.loads)).toBe('2');
  expect(await page.evaluate(()=>fetch('version.txt').then(r=>r.text()))).toBe('1');
  host.release(2);
  await page.waitForTimeout(1100);
  await expect(page.locator('#version')).toHaveText('1');
  await page.reload();
  for(const tab of [page,other]){
   await expect(tab.locator('#version')).toHaveText('2');
   await expect(tab).toHaveURL(url);
   expect(Number(await tab.evaluate(()=>sessionStorage.loads))).toBeGreaterThanOrEqual(tab===page?3:2);
  }
  const counts=await Promise.all([page,other].map(tab=>tab.evaluate(()=>sessionStorage.loads)));
  await page.waitForTimeout(1800);
  expect(await Promise.all([page,other].map(tab=>tab.evaluate(()=>sessionStorage.loads)))).toEqual(counts);
  await context.setOffline(true);await page.reload();
  await expect(page.locator('#version')).toHaveText('2');
  expect(await page.evaluate(()=>fetch('version.txt').then(r=>r.text()))).toBe('2');
 }finally{await host.close();}
});
