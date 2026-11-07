import {test, expect} from '@playwright/test';
import {expectToHold} from './helpers.mjs';
import {startUpdateServer} from './update-server.mjs';

// How long a release check started by these events could still change something.
const UPDATE_CHECK_WINDOW_MILLISECONDS = 1100;
// Long enough for a reload loop to show itself as a second reload.
const RELOAD_LOOP_WINDOW_MILLISECONDS = 1800;

test(
  'page reload checks for a release without background polling and preserves offline use',
  {tag: '@phone'},
  async ({page, context, baseURL}) => {
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
      await expectToHold(() => expect(host.failures).toBe(0), UPDATE_CHECK_WINDOW_MILLISECONDS);
      await page.reload();
      await expect.poll(() => host.failures).toBeGreaterThan(0);
      await expect(page.locator('#version')).toHaveText('1');
      expect(await page.evaluate(() => sessionStorage.loads)).toBe('2');
      expect(await page.evaluate(() => fetch('version.txt').then(response => response.text()))).toBe('1');
      // update() can resolve before updatefound reaches the page. A temporarily null installing
      // property is insufficient: observe the probe's worker and wait for its failed installation.
      await page.evaluate(async () => {
        const registration = window.registration;
        const waitForFailedInstallation = worker =>
          new Promise((resolve, reject) => {
            const onStateChange = () => {
              if (!['redundant', 'activated'].includes(worker.state)) return;
              worker.removeEventListener('statechange', onStateChange);
              if (worker.state === 'redundant') resolve();
              else reject(new Error('Incomplete release activated'));
            };
            worker.addEventListener('statechange', onStateChange);
            onStateChange();
          });
        if (registration.installing) await waitForFailedInstallation(registration.installing);
        const nextWorker = new Promise(resolve => {
          registration.addEventListener('updatefound', () => resolve(registration.installing), {once: true});
        });
        await registration.update();
        await waitForFailedInstallation(await nextWorker);
      });
      host.release(2);
      await expectToHold(() => expect(page.locator('#version')).toHaveText('1'), UPDATE_CHECK_WINDOW_MILLISECONDS);
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
      await expectToHold(async () => {
        const counts = await Promise.all([page, otherTab].map(tab => tab.evaluate(() => sessionStorage.loads)));
        expect(counts).toEqual(loadCounts);
      }, RELOAD_LOOP_WINDOW_MILLISECONDS);
      await context.setOffline(true);
      await page.reload();
      await expect(page.locator('#version')).toHaveText('2');
      expect(await page.evaluate(() => fetch('version.txt').then(response => response.text()))).toBe('2');
    } finally {
      await host.close();
    }
  }
);
