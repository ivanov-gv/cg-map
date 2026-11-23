import {test, expect} from '@playwright/test';
import {
  nearbyPlaces,
  openMenu,
  stubRouting,
  tapRenderedPlace,
  withFlipViewport
} from './helpers.mjs';

const renderedPlace = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'node/1',
      geometry: {type: 'Point', coordinates: [19.26, 42.44]},
      properties: {
        id: 'node/1',
        category: 'shops',
        kind: 'convenience',
        name: 'Test Shop',
        tags: {name: 'Test Shop', shop: 'convenience'}
      }
    }
  ]
};

test.beforeEach(async ({page}) => {
  await stubRouting(page);
  await page.goto('about:blank');
});

async function openApp(page, places = nearbyPlaces) {
  await page.route('**/data/places.geojson', route => route.fulfill({json: places}));
  await page.goto('./');
  await expect(page).not.toHaveURL(/\/web\//);
  await page.waitForFunction(
    () => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('search-place')
  );
  await expect(page.locator('#loading')).toBeHidden();
}

async function openSearchBubble(page) {
  await page.locator('#search').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'search');
  await expect(page.locator('#search-bubble')).toBeVisible();
}

async function swipe(page, deltaY) {
  const touch = await page.context().newCDPSession(page);
  const box = await page.locator('#place-card').boundingBox();
  const screenX = box.x + box.width / 2;
  const screenY = box.y + 30;
  const base = Date.now() / 1000;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{x: screenX, y: screenY, id: 1}],
    timestamp: base
  });
  for (let step = 1; step <= 5; step += 1) {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{x: screenX, y: screenY + (deltaY * step) / 5, id: 1}],
      timestamp: base + step * 0.012
    });
  }
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
    timestamp: base + 0.08
  });
}

async function expectAtOpening(page) {
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect(page.locator('#place-card')).toBeHidden();
  await expect(page.locator('#search-bubble')).toBeHidden();
  await expect(page.locator('#dock-content')).toBeHidden();
}

async function expectLeftApp(page) {
  await expect(page).toHaveURL('about:blank');
}

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
        setTimeout(() => {
          map.queryRenderedFeatures = original;
          resolve();
        }, 700);
      })
  );
}

test('map-tap card: Back closes it, next Back leaves', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await openApp(page, renderedPlace);
  await tapRenderedPlace(page, [19.26, 42.44], 'node/1');
  await expect(page.locator('#place-card')).toBeVisible();
  await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'full');

  await page.goBack();
  await expect(page.locator('#place-card')).toBeHidden();
  await expectAtOpening(page);

  await page.goBack();
  await expectLeftApp(page);
});

test('map-tap card then dock: Back closes the dock before the covered card', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await openApp(page, renderedPlace);
  await tapRenderedPlace(page, [19.26, 42.44], 'node/1');
  const card = page.locator('#place-card');
  await expect(card).toHaveAttribute('data-state', 'full');

  await openMenu(page);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');

  await page.goBack();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute('data-state', 'full');

  await page.goBack();
  await expectAtOpening(page);
});

test(
  'dock to result to Full: Back gives Peek, Back closes card, Back closes search, Back closes dock, Back leaves',
  {tag: ['@phone', '@phone-only']},
  async ({page}) => {
    await openApp(page);
    await openMenu(page);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
    await page.locator('.result', {hasText: 'Nearby place 0'}).click();
    await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'peek');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'search');
    await page.locator('#place-card').evaluate(card =>
      Promise.allSettled(card.getAnimations().map(animation => animation.finished))
    );

    await swipe(page, -170);
    await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'full');

    await page.goBack();
    await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'peek');
    await page.goBack();
    await expect(page.locator('#place-card')).toBeHidden();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'search');
    await page.goBack();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await page.goBack();
    await expectLeftApp(page);
  }
);

test('× on search with a card open, then Back leaves', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await openApp(page);
  await openSearchBubble(page);
  await page.locator('.result', {hasText: 'Nearby place 0'}).click();
  await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'peek');

  await page.locator('#clear-search').click();
  await expectAtOpening(page);
  await page.goBack();
  await expectLeftApp(page);
});

test('search → menu (dock) → menu (close) → Back leaves', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await openApp(page);
  await openSearchBubble(page);

  await page.locator('#menu-toggle').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
  await page.locator('#menu-toggle').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');

  await page.goBack();
  await expectLeftApp(page);
});

test('Escape on phone card, then Back leaves', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await openApp(page, renderedPlace);
  await tapRenderedPlace(page, [19.26, 42.44], 'node/1');
  await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'full');

  await page.keyboard.press('Escape');
  await expectAtOpening(page);
  await page.goBack();
  await expectLeftApp(page);
});

test('Escape on phone search, then Back leaves', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await openApp(page);
  await openSearchBubble(page);

  await page.keyboard.press('Escape');
  await expectAtOpening(page);
  await page.goBack();
  await expectLeftApp(page);
});

test('Escape on phone dock, then Back leaves', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await openApp(page);
  await openMenu(page);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');

  await page.keyboard.press('Escape');
  await expectAtOpening(page);
  await page.goBack();
  await expectLeftApp(page);
});

test('Flip modes → × close → Back leaves', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await withFlipViewport(page, async () => {
    await openApp(page);
    await page.locator('#menu-toggle').click();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
    await expect.poll(() => page.evaluate(() => window.kompasDebug.flipDockScreen)).toBe('list');
    await page.locator('#menu-toggle').click();
    await expect.poll(() => page.evaluate(() => window.kompasDebug.flipDockScreen)).toBe('modes');

    await page.locator('#menu-toggle').click();
    await expectAtOpening(page);
    await page.goBack();
    await expectLeftApp(page);
  });
});

test('Search key (#261) then Back leaves', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await openApp(page);
  await page.locator('body').click({position: {x: 10, y: 400}});
  await page.keyboard.press('/');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'search');

  await page.goBack();
  await expectAtOpening(page);
  await page.goBack();
  await expectLeftApp(page);
});

test('reload at depth 2 then Back leaves within 1 press', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await openApp(page);
  await openSearchBubble(page);
  await page.locator('.result', {hasText: 'Nearby place 0'}).click();
  await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'peek');

  await page.reload();
  await page.waitForFunction(
    () => window.kompasDebug?.map?.isStyleLoaded() && window.kompasDebug.map.getLayer('search-place')
  );
  await expect(page.locator('#loading')).toBeHidden();
  await expectAtOpening(page);

  await page.goBack();
  await expectLeftApp(page);
});

test('map-tap compaction (bubble → strip) then Back → bubble', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await openApp(page);
  await openSearchBubble(page);
  await tapEmptyMap(page);
  await expect(page.locator('#results-strip')).toBeVisible();
  await expect(page.locator('#search-bubble')).toBeHidden();

  await page.goBack();
  await expect(page.locator('#search-bubble')).toBeVisible();
  await expect(page.locator('#results-strip')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'search');

  await page.goBack();
  await expectAtOpening(page);
  await page.goBack();
  await expectLeftApp(page);
});
