// @phone
import {expect, test} from '@playwright/test';
import {camera, closeMenu, mapIdle, ready, stubRouting, tapRenderedPlace} from './helpers.mjs';

const MOBILE_VIEWPORT = {width: 412, height: 840};
const FLIP_VIEWPORT = {width: 340, height: 250};

const foldPlaces = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      id: 'food/cafe-one',
      geometry: {type: 'Point', coordinates: [19.2601, 42.4401]},
      properties: {id: 'food/cafe-one', name: 'Cafe One', category: 'food', kind: 'cafe'}
    },
    {
      type: 'Feature',
      id: 'food/cafe-two',
      geometry: {type: 'Point', coordinates: [19.2602, 42.4402]},
      properties: {id: 'food/cafe-two', name: 'Cafe Two', category: 'food', kind: 'cafe'}
    },
    {
      type: 'Feature',
      id: 'shops/far-shop',
      geometry: {type: 'Point', coordinates: [19.29, 42.46]},
      properties: {id: 'shops/far-shop', name: 'Far Shop', category: 'shops', kind: 'shop'}
    },
    {
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [19.2603, 42.4403]},
      properties: {id: 'shops/market', name: 'Market', category: 'shops', kind: 'shop'}
    }
  ]
};

async function openApp(page, viewport = MOBILE_VIEWPORT) {
  await stubRouting(page);
  await page.route('**/data/places.geojson', route => route.fulfill({json: foldPlaces}));
  await page.setViewportSize(viewport);
  await ready(page);
}

async function switchViewport(page, viewport, device) {
  await mapIdle(page);
  const before = await camera(page);
  await page.setViewportSize(viewport);
  await expect(page.locator('body')).toHaveAttribute('data-device', device);
  await mapIdle(page);
  expect(await camera(page)).toEqual(before, 'the map camera survives the device switch');
}

async function expectDevice(page, device) {
  await expect(page.locator('body')).toHaveAttribute('data-device', device);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.deviceClass)).toBe(device);
}

async function expectQueryAndCategoryValue(page, query = 'Cafe', category = 'food') {
  await expect(page.locator('#search')).toHaveValue(query);
  await expect(page.locator(`#categories button[data-category="${category}"]`)).toHaveAttribute(
    'aria-pressed',
    'true'
  );
}

async function expectQueryAndCategory(page) {
  await expectQueryAndCategoryValue(page);
  const visibility = await page.evaluate(() =>
    window.kompasDebug.map.getLayoutProperty('search-result-places', 'visibility')
  );
  expect(visibility, 'result highlights stay on the map').toBe('visible');
  await expect(page.locator('#results .result')).toHaveCount(2);
}

async function expectOpeningView(page) {
  await expectDevice(page, 'mobile');
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#dock-content')).toBeHidden();
  await expect(page.locator('#categories')).toBeHidden();
}

async function expectFlipOpeningView(page) {
  await expectDevice(page, 'flip');
  await expect(page.locator('#search')).toBeHidden();
  await expect(page.locator('#dock-content')).toBeHidden();
  await expect(page.locator('#categories')).toBeHidden();
  await expect(page.locator('#menu-toggle')).toBeVisible();
  await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-label', 'Open menu');
}

async function expectMobileSearch(page) {
  await expectDevice(page, 'mobile');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'search');
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#search-bubble')).toBeVisible();
  await expect(page.locator('#categories')).toBeVisible();
  await expect(page.locator('#dock-content')).toBeHidden();
  await expect(page.locator('.dock-footer')).toBeHidden();
}

async function expectMobileDock(page) {
  await expectDevice(page, 'mobile');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#dock-content')).toBeVisible();
  await expect(page.locator('#categories')).toBeVisible();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('.dock-footer')).toBeVisible();
  await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-label', 'Close menu');
}

async function expectFlipList(page) {
  await expectDevice(page, 'flip');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#dock-content')).toBeVisible();
  await expect(page.locator('#categories')).toBeVisible();
  await expect(page.locator('#results')).toBeVisible();
  await expect(page.locator('.dock-footer')).toBeHidden();
  await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-label', 'Show map modes');
  expect(await page.evaluate(() => window.kompasDebug.flipDockScreen)).toBe('list');
}

async function expectFlipModes(page) {
  await expectDevice(page, 'flip');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
  await expect(page.locator('#search')).toBeVisible();
  await expect(page.locator('#dock-content')).toBeVisible();
  await expect(page.locator('#categories')).toBeVisible();
  await expect(page.locator('#results')).toBeHidden();
  await expect(page.locator('.dock-footer')).toBeVisible();
  await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-label', 'Close menu');
  expect(await page.evaluate(() => window.kompasDebug.flipDockScreen)).toBe('modes');
}

async function expectCard(page, state) {
  await expect(page.locator('#place-card')).toBeVisible();
  await expect(page.locator('#place-card')).toHaveAttribute('data-state', state);
  await expect(page.locator('#place-name')).toHaveText('Cafe One');
  await expect.poll(() => page.evaluate(() => window.kompasDebug.selected)).toBe('food/cafe-one');
  await expect(page.locator('#dock-content')).toBeHidden();
  const device = await page.locator('body').getAttribute('data-device');
  const expectedMenuLabel =
    device === 'flip'
      ? state === 'fullscreen'
        ? 'Back to summary'
        : 'Close details'
      : 'Open menu';
  await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-label', expectedMenuLabel);
  if (device === 'flip') {
    await expect(page.locator('#search')).toBeHidden();
    return;
  }
  if (state === 'fullscreen') {
    await expect(page.locator('.search-bar')).toBeHidden();
    await expect(page.locator('.position-control')).toBeHidden();
  }
}

async function expectMobileStandaloneChips(page) {
  await expectDevice(page, 'mobile');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect(page.locator('#active-category-chip')).toBeVisible();
  await expect(page.locator('#active-category-chip-label')).toHaveText('Eat & drink');
  await expect(page.locator('#query-chip')).toBeHidden();
  await expectQueryAndCategoryValue(page);
}

async function expectFlipStandaloneChips(page) {
  await expectDevice(page, 'flip');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect(page.locator('#dock-content')).toBeHidden();
  await expect(page.locator('#active-category-chip')).toBeVisible();
  await expect(page.locator('#active-category-chip-label')).toHaveText('Eat & drink');
  await expect(page.locator('#query-chip')).toBeVisible();
  await expect(page.locator('#query-chip-label')).toHaveText('“Cafe”');
  await expectQueryAndCategoryValue(page);
}

async function expectMobileCategoryChipWithCard(page) {
  await expect(page.locator('#active-category-chip')).toBeVisible();
  await expect(page.locator('#active-category-chip-label')).toHaveText('Eat & drink');
  await expect(page.locator('#query-chip')).toBeHidden();
}

async function expectFlipChipsHiddenUnderCard(page) {
  await expect(page.locator('#active-category-chip')).toBeHidden();
  await expect(page.locator('#query-chip')).toBeHidden();
}

async function pullFlipCardUp(page) {
  const box = await page.locator('#place-card').boundingBox();
  const screenX = box.x + box.width / 2;
  const screenY = box.y + 24;
  const touch = await page.context().newCDPSession(page);
  const start = Date.now() / 1000;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{x: screenX, y: screenY, id: 1}],
    timestamp: start
  });
  for (let step = 1; step <= 5; step++)
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{x: screenX, y: screenY - (120 * step) / 5, id: 1}],
      timestamp: start + step * 0.012
    });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
    timestamp: start + 6 * 0.012
  });
  await touch.detach();
}

async function searchForCafe(page) {
  await page.locator('#search').fill('Cafe');
  await page.locator('#categories button[data-category="food"]').click();
  await expect(page.locator('#results .result')).toHaveCount(2);
  await expectQueryAndCategory(page);
}

async function openFirstResult(page) {
  await page.locator('#results .result[data-id="food/cafe-one"]').click();
  await expectCard(page, 'peek');
}

test.describe('Fold and unfold layout', () => {
  test('opening view folds to Flip and unfolds back repeatedly', {tag: '@phone'}, async ({page}) => {
    await openApp(page);
    await expectOpeningView(page);

    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectFlipOpeningView(page);
    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectOpeningView(page);
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectFlipOpeningView(page);
    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectOpeningView(page);
  });

  test('Mobile search bubble with query and category folds to Flip dock and back', {tag: '@phone'}, async ({page}) => {
    await openApp(page);
    await searchForCafe(page);
    await expectMobileSearch(page);

    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectFlipList(page);
    await expectQueryAndCategory(page);
    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectMobileDock(page);
    await expectQueryAndCategory(page);
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectFlipList(page);
    await expectQueryAndCategory(page);
  });

  test('open Mobile dock folds to Flip list and unfolds back', {tag: '@phone'}, async ({page}) => {
    await openApp(page);
    await page.locator('#menu-toggle').click();
    await expectMobileDock(page);

    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectFlipList(page);
    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectMobileDock(page);
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectFlipList(page);
  });

  test('Flip modes menu unfolds to Mobile dock and folds back to the list', {tag: '@phone'}, async ({page}) => {
    await openApp(page, FLIP_VIEWPORT);
    await expectFlipOpeningView(page);
    await page.locator('#menu-toggle').click();
    await page.locator('#menu-toggle').click();
    await expectFlipModes(page);

    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectMobileDock(page);
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectFlipList(page);
    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectMobileDock(page);
  });

  test('active category chip survives folding with the map open', {tag: '@phone'}, async ({page}) => {
    await openApp(page);
    await searchForCafe(page);
    await page.keyboard.press('Escape');
    await expectOpeningView(page);
    await expect(page.locator('#active-category-chip')).toBeVisible();
    await expect(page.locator('#active-category-chip-label')).toHaveText('Eat & drink');

    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectFlipOpeningView(page);
    await expect(page.locator('#active-category-chip')).toBeVisible();
    await expect(page.locator('#active-category-chip-label')).toHaveText('Eat & drink');
    await expectQueryAndCategoryValue(page);
    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectOpeningView(page);
    await expectQueryAndCategoryValue(page);
    await expect(page.locator('#active-category-chip-label')).toHaveText('Eat & drink');
  });

  test('category and query chips follow the fold while panels stay closed', {tag: '@phone'}, async ({page}) => {
    await openApp(page);
    await searchForCafe(page);
    await page.keyboard.press('Escape');
    await expectMobileStandaloneChips(page);

    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectFlipStandaloneChips(page);
    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectMobileStandaloneChips(page);
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectFlipStandaloneChips(page);

    await page.locator('#active-category-chip-label').click();
    await expectFlipList(page);
    await expect(page.locator('#active-category-chip')).toBeHidden();
    await expect(page.locator('#query-chip')).toBeHidden();

    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectMobileDock(page);
    await expect(page.locator('#active-category-chip')).toBeHidden();
    await expect(page.locator('#query-chip')).toBeHidden();
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectFlipList(page);
    await expect(page.locator('#active-category-chip')).toBeHidden();
    await expect(page.locator('#query-chip')).toBeHidden();

    await closeMenu(page);
    await expectFlipStandaloneChips(page);
    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectMobileStandaloneChips(page);
  });

  test('Mobile Peek folds to Flip Peek and unfolds back', {tag: '@phone'}, async ({page}) => {
    await openApp(page);
    await searchForCafe(page);
    await openFirstResult(page);

    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'peek');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await expectQueryAndCategory(page);
    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectCard(page, 'peek');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'search');
    await expect(page.locator('#search-bubble')).toBeVisible();
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'peek');
  });

  test('Mobile Full folds to Flip Peek and unfolds to Mobile Peek', {tag: '@phone'}, async ({page}) => {
    await openApp(page);
    await searchForCafe(page);
    await page.keyboard.press('Escape');
    await expectMobileStandaloneChips(page);
    await tapRenderedPlace(page, [19.2601, 42.4401], 'food/cafe-one');
    await expectCard(page, 'full');
    await expectMobileCategoryChipWithCard(page);

    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'peek');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await expectFlipChipsHiddenUnderCard(page);
    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectCard(page, 'peek');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await expectMobileCategoryChipWithCard(page);
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'peek');
    await expectFlipChipsHiddenUnderCard(page);
  });

  test('Mobile Fullscreen folds to Flip Fullscreen and unfolds back', {tag: '@phone'}, async ({page}) => {
    await openApp(page);
    await searchForCafe(page);
    await openFirstResult(page);
    await page.locator('#card-handle').click();
    await page.locator('#card-handle').click();
    await expectCard(page, 'fullscreen');

    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'fullscreen');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await expectQueryAndCategory(page);
    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectCard(page, 'fullscreen');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'search');
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'fullscreen');
  });

  test('Flip Peek unfolds to Mobile Peek and folds back', {tag: '@phone'}, async ({page}) => {
    await openApp(page, FLIP_VIEWPORT);
    await page.locator('#menu-toggle').click();
    await openFirstResult(page);

    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectCard(page, 'peek');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'search');
    await expect(page.locator('#search-bubble')).toBeVisible();
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'peek');
  });

  test('Flip Fullscreen unfolds to Mobile Fullscreen and folds back', {tag: '@phone'}, async ({page}) => {
    await openApp(page, FLIP_VIEWPORT);
    await page.locator('#menu-toggle').click();
    await openFirstResult(page);
    await page.locator('#card-handle').click();
    await expectCard(page, 'fullscreen');

    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectCard(page, 'fullscreen');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'search');
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'fullscreen');
  });

  test('a pulled Flip Fullscreen card survives folding and unfolding', {tag: '@phone'}, async ({page}) => {
    await openApp(page, FLIP_VIEWPORT);
    await page.locator('#menu-toggle').click();
    await openFirstResult(page);

    await pullFlipCardUp(page);
    await expectCard(page, 'fullscreen');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await expect(page.locator('#menu-toggle')).toHaveAttribute('aria-label', 'Back to summary');
    await expect(page.locator('#active-category-chip')).toBeHidden();
    await expect(page.locator('#query-chip')).toBeHidden();
    await mapIdle(page);

    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectCard(page, 'fullscreen');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'search');
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'fullscreen');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');

    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectCard(page, 'fullscreen');
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'fullscreen');
  });

  test('Mobile dock over an open card folds to a Flip card that returns to the dock', {tag: '@phone'}, async ({
    page
  }) => {
    await openApp(page);
    await searchForCafe(page);
    await openFirstResult(page);
    await page.locator('#menu-toggle').click();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
    await expect(page.locator('#dock-content')).toBeVisible();
    await expect(page.locator('#place-card')).toBeVisible();

    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'peek');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await page.locator('#menu-toggle').click();
    await expect(page.locator('#place-card')).toBeHidden();
    await expectFlipList(page);
    await expectQueryAndCategory(page);
  });

  test('Back and the Icon Button share the folded Flip card step', {tag: '@phone'}, async ({page}) => {
    await openApp(page);
    await searchForCafe(page);
    await openFirstResult(page);
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'peek');

    await page.goBack();
    await expect(page.locator('#place-card')).toBeHidden();
    await expectFlipList(page);

    await openFirstResult(page);
    await expectCard(page, 'peek');
    await page.locator('#menu-toggle').click();
    await expect(page.locator('#place-card')).toBeHidden();
    await expectFlipList(page);
  });

  test('a Flip card opened from the map unfolds and folds back with its step', {tag: '@phone'}, async ({page}) => {
    await openApp(page, FLIP_VIEWPORT);
    await tapRenderedPlace(page, [19.2601, 42.4401], 'food/cafe-one');
    await expectCard(page, 'peek');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');

    await switchViewport(page, MOBILE_VIEWPORT, 'mobile');
    await expectCard(page, 'peek');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await expectCard(page, 'peek');
  });

  test('folding holds the camera but a later selection frames the new result', {tag: '@phone'}, async ({page}) => {
    await openApp(page);
    await searchForCafe(page);
    await switchViewport(page, FLIP_VIEWPORT, 'flip');
    await page.locator('#categories button[data-category="food"]').click();
    await page.locator('#search').fill('Far');
    await expect(page.locator('#results .result[data-id="shops/far-shop"]')).toBeVisible();
    const beforeSelection = await camera(page);

    await page.locator('#results .result[data-id="shops/far-shop"]').click();
    await mapIdle(page);
    expect(await camera(page)).not.toEqual(beforeSelection, 'a new selection resumes result framing');
    await expect(page.locator('#place-name')).toHaveText('Far Shop');
    await expect.poll(() => page.evaluate(() => window.kompasDebug.selected)).toBe('shops/far-shop');
  });
});
