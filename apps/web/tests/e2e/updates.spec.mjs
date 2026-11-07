import {test, expect} from '@playwright/test';
import {startUpdateServer} from './update-server.mjs';

test('page reload checks for a release without background polling and preserves offline use', {tag: '@phone'}, async ({
  page,
  context,
  baseURL
}) => {
  const scope = new URL(baseURL).pathname;
  const host = await startUpdateServer(scope);
  try {
    const url = host.url + '?lang=sr#point';
    await page.goto(url);
    await page.waitForFunction(() => navigator.serviceWorker.controller && window.registration);
    await expect(page.locator('#version')).toHaveText('1');
    expect(await page.evaluate(() => sessionStorage.loads)).toBe('1');
    const otherTab = await context.newPage();
    await otherTab.goto(url);
    await otherTab.waitForFunction(() => navigator.serviceWorker.controller && window.registration);
    // Finish the initial load checks before publishing the next fixture release.
    await otherTab.evaluate(() => window.registration.update());
    host.release(2, true);
    await page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('pageshow'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1100);
    expect(host.failures).toBe(0);
    await page.reload();
    await expect.poll(() => host.failures).toBeGreaterThan(0);
    await expect(page.locator('#version')).toHaveText('1');
    expect(await page.evaluate(() => sessionStorage.loads)).toBe('2');
    expect(await page.evaluate(() => fetch('version.txt').then(response => response.text()))).toBe('1');
    // register() and the explicit update() can overlap. Drain the failed update before making
    // its assets available, or an in-flight installer can succeed without the next reload.
    await page.evaluate(() => window.registration.update());
    await expect.poll(() => page.evaluate(() => window.registration.installing === null)).toBe(true);
    host.release(2);
    await page.waitForTimeout(1100);
    await expect(page.locator('#version')).toHaveText('1');
    await page.reload();
    for (const tab of [page, otherTab]) {
      await expect(tab.locator('#version')).toHaveText('2');
      await expect(tab).toHaveURL(url);
      expect(Number(await tab.evaluate(() => sessionStorage.loads))).toBeGreaterThanOrEqual(
        tab === page ? 3 : 2
      );
    }
    const loadCounts = await Promise.all(
      [page, otherTab].map(tab => tab.evaluate(() => sessionStorage.loads))
    );
    await page.waitForTimeout(1800);
    expect(await Promise.all([page, otherTab].map(tab => tab.evaluate(() => sessionStorage.loads)))).toEqual(
      loadCounts
    );
    await context.setOffline(true);
    await page.reload();
    await expect(page.locator('#version')).toHaveText('2');
    expect(await page.evaluate(() => fetch('version.txt').then(response => response.text()))).toBe('2');
  } finally {
    await host.close();
  }
});
