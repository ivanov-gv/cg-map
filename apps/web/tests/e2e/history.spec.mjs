import {test, expect} from '@playwright/test';
import {
  closeCard,
  nearbyPlaces,
  openMenu,
  ready,
  stubRouting,
  withFlipViewport
} from './helpers.mjs';

test.beforeEach(({page}) => stubRouting(page));

async function tapEmptyMap(page) {
  await page.evaluate(
    () =>
      new Promise(resolve => {
        const map = window.kompasDebug.map;
        const original = map.queryRenderedFeatures.bind(map);
        map.queryRenderedFeatures = (geometry, options) => (options?.layers ? [] : original(geometry, options));
        const canvas = map.getCanvas();
        const bounds = canvas.getBoundingClientRect();
        const point = {x: bounds.width / 2, y: bounds.height / 2};
        map.fire('click', {point, lngLat: map.unproject(point), originalEvent: {target: canvas}});
        // installMapTaps defers selection; keep the empty-map stub active until it runs.
        setTimeout(() => {
          map.queryRenderedFeatures = original;
          resolve();
        }, 700);
      })
  );
}

async function swipeDown(page, deltaY = 180) {
  const touch = await page.context().newCDPSession(page);
  const box = await page.locator('#place-card').boundingBox();
  const screenX = box.x + box.width / 2;
  const screenY = box.y + 30;
  const baseTimestampSeconds = Date.now() / 1000;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{x: screenX, y: screenY, id: 1}],
    timestamp: baseTimestampSeconds
  });
  for (let step = 1; step <= 5; step++) {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{x: screenX, y: screenY + (deltaY * step) / 5, id: 1}],
      timestamp: baseTimestampSeconds + step * 0.012
    });
  }
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
    timestamp: baseTimestampSeconds + 6 * 0.012
  });
}

async function swipeUp(page, deltaY = -180) {
  await swipeDown(page, deltaY);
}

async function openSearchBubble(page) {
  await page.locator('#search').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'search');
  await expect(page.locator('#search-bubble')).toBeVisible();
}

async function openPhoneResultCard(page) {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await openSearchBubble(page);
  await page.locator('.result', {hasText: 'Nearby place 0'}).click();
  await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'peek');
}

test('phone Back steps search bubble to map then leaves only from opening view', {tag: '@phone'}, async ({page, isMobile}) => {
  test.skip(!isMobile, 'phone layout');
  await page.goto('about:blank');
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await page.goto('./');
  await expect(page).not.toHaveURL(/\/web\//);
  await page.waitForFunction(() => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('search-place'));
  await expect(page.locator('#loading')).toBeHidden();

  await openSearchBubble(page);
  await page.goBack();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect(page.locator('#search-bubble')).toBeHidden();
  await expect(page).toHaveURL(/\/($|\?)/);
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('phone Back steps dock to map then leaves only from opening view', {tag: '@phone'}, async ({page, isMobile}) => {
  test.skip(!isMobile, 'phone layout');
  await page.goto('about:blank');
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await page.goto('./');
  await page.waitForFunction(() => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('search-place'));
  await expect(page.locator('#loading')).toBeHidden();

  await openMenu(page);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
  await page.goBack();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect(page.locator('#dock-content')).toBeHidden();
  await expect(page).toHaveURL(/\/($|\?)/);
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('empty map tap compacts phone search bubble to strip and Back restores it', {tag: '@phone'}, async ({page, isMobile}) => {
  test.skip(!isMobile, 'phone layout');
  await page.goto('about:blank');
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await page.goto('./');
  await page.waitForFunction(() => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('search-place'));
  await expect(page.locator('#loading')).toBeHidden();

  await openSearchBubble(page);
  await tapEmptyMap(page);
  await expect(page.locator('#search-bubble')).toBeHidden();
  await expect(page.locator('#results-strip')).toBeVisible();
  await expect(page.locator('#place-card')).toBeHidden();

  await page.locator('#results-strip').click();
  await expect(page.locator('#search-bubble')).toBeVisible();
  await expect(page.locator('#results-strip')).toBeHidden();

  await tapEmptyMap(page);
  await expect(page.locator('#search-bubble')).toBeHidden();
  await expect(page.locator('#results-strip')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#search-bubble')).toBeVisible();
  await expect(page.locator('#results-strip')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'search');

  await page.goBack();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('phone Back steps card fullscreen, full, peek, then closes card and leaves only from opening view', {tag: '@phone'}, async ({page, isMobile}) => {
  test.skip(!isMobile, 'phone layout');
  await page.goto('about:blank');
  await openPhoneResultCard(page);
  await swipeUp(page, -160);
  await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'full');
  await swipeUp(page, -180);
  await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'fullscreen');

  await page.goBack();
  await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'full');
  await page.goBack();
  await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'peek');
  await page.goBack();
  await expect(page.locator('#place-card')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'search');

  await page.goBack();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('phone close button keeps history consistent so Back does not reopen closed state', {tag: '@phone'}, async ({page, isMobile}) => {
  test.skip(!isMobile, 'phone layout');
  await page.goto('about:blank');
  await openPhoneResultCard(page);
  await swipeUp(page, -160);
  await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'full');
  await closeCard(page);
  await expect(page.locator('#place-card')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'search');
  await page.goBack();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect(page.locator('#place-card')).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('phone swipe-away keeps history consistent so Back does not reopen closed state', {tag: '@phone'}, async ({page, isMobile}) => {
  test.skip(!isMobile, 'phone layout');
  await page.goto('about:blank');
  await openPhoneResultCard(page);
  await swipeDown(page, 120);
  await expect(page.locator('#place-card')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'search');
  await page.goBack();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect(page.locator('#place-card')).toBeHidden();
  await page.goBack();
  await expect(page).toHaveURL('about:blank');
});

test('Flip Back steps modes, dock, and card states and leaves only from opening view', {tag: '@phone'}, async ({page, isMobile}) => {
  test.skip(!isMobile, 'touch emulation');
  await withFlipViewport(page, async () => {
    await page.goto('about:blank');
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await page.goto('./');
    await page.waitForFunction(() => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('search-place'));
    await expect(page.locator('#loading')).toBeHidden();

    await openMenu(page);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
    await page.locator('#menu-toggle').click();
    await expect.poll(() => page.evaluate(() => window.kompasDebug.flipDockScreen)).toBe('modes');
    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.kompasDebug.flipDockScreen)).toBe('list');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
    await page.goBack();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await page.goBack();
    await expect(page).toHaveURL('about:blank');

    await page.goto('./');
    await page.waitForFunction(() => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('search-place'));
    await expect(page.locator('#loading')).toBeHidden();
    await openMenu(page);
    await page.locator('#results .result').first().click();
    await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'peek');
    await swipeUp(page, -120);
    await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'full');
    await page.goBack();
    await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'peek');
    await page.goBack();
    await expect(page.locator('#place-card')).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
    await page.goBack();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await page.goBack();
    await expect(page).toHaveURL('about:blank');
  });
});
