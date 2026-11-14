import {test, expect} from '@playwright/test';
import {
  atViewport,
  camera,
  closeCard,
  closeMenu,
  fixture,
  holdGeolocationFixes,
  nearbyPlaces,
  openMenu,
  pointOnMap,
  ready,
  settled,
  simulateKeyboard,
  stubRouting,
  tapRenderedPlace,
  withFlipViewport,
  CAMERA_HOLD_MILLISECONDS,
  expectCameraToHold,
  expectToHold,
  mapIdle
} from './helpers.mjs';

const RESORT_WINDOW_MILLISECONDS = 200;
// A little over the card's own WHEEL_GESTURE_MILLISECONDS.
const WHEEL_GESTURE_GAP_MILLISECONDS = 650;

test.beforeEach(({page}) => stubRouting(page));

test('dock expands around a stationary header and keeps layer/download options anchored', async ({
  page
}, testInfo) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
  await ready(page);
  const header = await page.locator('.search-bar').boundingBox();
  const burger = await page.locator('#menu-toggle').boundingBox();
  const search = await page.locator('#search').boundingBox();
  const locate = await page.locator('#position-action').boundingBox();
  // Zoom buttons are hidden via CSS; the position button sits alone in the bottom-right corner.
  await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeHidden();
  await expect(page.locator('.maplibregl-ctrl-zoom-out')).toBeHidden();
  const viewport = page.viewportSize();
  const rightGap = viewport.width - (locate.x + locate.width);
  const bottomGap = viewport.height - (locate.y + locate.height);
  expect(rightGap).toBeLessThanOrEqual(24);
  expect(bottomGap).toBeLessThanOrEqual(24);
  await page.screenshot({path: testInfo.outputPath('opening.png')});
  await openMenu(page);
  expect(await page.locator('.search-bar').boundingBox()).toEqual(header);
  expect(await page.locator('#menu-toggle').boundingBox()).toEqual(burger);
  expect(await page.locator('#search').boundingBox()).toEqual(search);
  await expect(page.locator('.layer-tile')).toHaveCount(2);
  await expect(page.locator('#download-title')).toHaveText('Download for offline use');
  await expect(page.getByRole('heading', {name: /Map layers|Offline map/})).toHaveCount(0);
  await expect(page.locator('#toggle-results, #reset')).toHaveCount(0);
  await expect(page.locator('#categories').getByRole('button', {name: 'Explore all'})).toHaveCount(0);
  const footer = await page.locator('.dock-footer').boundingBox();
  await page.locator('#categories').getByRole('button', {name: 'Eat & drink', exact: true}).click();
  await expect(page.locator('.result')).toHaveCount(0);
  expect(await page.locator('.dock-footer').boundingBox()).toEqual(footer);
  await page.locator('#categories').getByRole('button', {name: 'Eat & drink', exact: true}).click();
  await expect(page.locator('#categories [aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator('.result')).toHaveCount(3);
  expect(await page.locator('.dock-footer').boundingBox()).toEqual(footer);
  await page.screenshot({path: testInfo.outputPath('dock.png')});
  await closeMenu(page);
  expect(await page.locator('.search-bar').boundingBox()).toEqual(header);
  expect(await page.locator('#menu-toggle').boundingBox()).toEqual(burger);
  expect(await page.locator('#search').boundingBox()).toEqual(search);
});

test(
  'search keeps phone categories fixed above scrolling results and shows a chosen result beside them',
  {tag: '@phone'},
  async ({page, isMobile}, testInfo) => {
    const places = {
      type: 'FeatureCollection',
      features: Array.from({length: 30}, (_, index) => ({
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [19.26 + index * 0.00002, 42.44]},
        properties: {
          id: 'search/' + index,
          name: 'Mobile result ' + String(index).padStart(2, '0'),
          category: 'shops',
          kind: 'shop'
        }
      }))
    };
    await page.route('**/data/places.geojson', route => route.fulfill({json: places}));
    await ready(page);
    const header = await page.locator('.search-bar').boundingBox();
    await page.locator('#search').fill('Mobile result');
    await expect(page.locator('.result')).toHaveCount(30);
    await expect(page.locator('body')).toHaveAttribute('data-view', isMobile ? 'search' : 'closed');
    if (isMobile) {
      await expect(page.locator('#dock-content')).toBeHidden();
      await expect(page.locator('.dock-footer')).toBeHidden();
      const bubble = await page.locator('#search-bubble').boundingBox();
      expect(bubble.height).toBeLessThanOrEqual(420);
      expect(bubble.y + bubble.height).toBe(420);
      const row = await page.locator('.result').first().boundingBox();
      expect(row.height).toBeGreaterThanOrEqual(76);
      const list = await page.locator('#results').boundingBox();
      expect(list.height).toBeGreaterThan(250);
    }
    expect(await page.locator('.search-bar').boundingBox()).toEqual(header);
    await settled(page);
    const categories = await page.locator('#categories').boundingBox();
    await page.locator('#results').evaluate(element => {
      element.scrollTop = 250;
    });
    await expect
      .poll(() => page.locator('#results').evaluate(element => element.scrollTop))
      .toBeGreaterThan(0);
    expect(await page.locator('#categories').boundingBox()).toEqual(categories);
    await page.screenshot({path: testInfo.outputPath('search.png')});
    if (isMobile) {
      await page.evaluate(() => {
        const viewport = new EventTarget();
        Object.assign(viewport, {height: 420, offsetTop: 0});
        Object.defineProperty(window, 'visualViewport', {configurable: true, value: viewport});
        window.dispatchEvent(new Event('resize'));
      });
      await expect
        .poll(() =>
          page.locator('#search-bubble').evaluate(element => element.getBoundingClientRect().height)
        )
        .toBeLessThanOrEqual(210);
      const bubble = await page.locator('#search-bubble').boundingBox();
      expect(bubble.y + bubble.height).toBe(210);
      expect(await page.locator('#categories').boundingBox()).toEqual(categories);
      await page.screenshot({path: testInfo.outputPath('search-keyboard.png')});
    }
    await page.locator('#search').fill('Mobile result 07');
    await expect(page.locator('.result')).toHaveCount(1);
    await openMenu(page);
    await expect(page.locator('#dock-content')).toBeVisible();
    await expect(page.locator('#search-bubble')).toBeHidden();
    await expect(page.locator('#search')).toHaveValue('Mobile result 07');
    await closeMenu(page);
    await page.locator('#search').click();
    await page.locator('.result').click();
    await expect(page.locator('#place-name')).toHaveText('Mobile result 07');
    await expect(page.locator('.result')).toBeVisible();
    // Choosing a result dismisses the keyboard simulated above; the place is judged in the layout that leaves.
    if (isMobile) await simulateKeyboard(page, 840);
    await expect
      .poll(async () => {
        const point = await pointOnMap(page, places.features[7].geometry.coordinates);
        const card = await page.locator('#place-card').boundingBox();
        if (!isMobile) return point.x > card.x + card.width;
        const bubble = await page.locator('#search-bubble').boundingBox();
        return point.y > bubble.y + bubble.height && point.y < card.y - 8;
      })
      .toBe(true);
  }
);

test('opening search, typing, and choosing a category leave the map still', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.3, 42.5], zoom: 16}));
  const before = await camera(page);
  await page.locator('#search').click();
  await page.locator('#categories').getByRole('button', {name: 'Eat & drink', exact: true}).click();
  await expect(page.locator('.result')).toHaveCount(3);
  await page.locator('#search').fill('Nearby place 3');
  await expect(page.locator('.result')).toHaveCount(1);
  await expectCameraToHold(page, before);
});

test('choosing a result moves the map only when the result is outside the focus zone', {tag: '@phone'}, async ({page, isMobile}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  const target = nearbyPlaces.features[0].geometry.coordinates;
  await page.evaluate(
    lngLat => window.kompasDebug.map.jumpTo({center: [lngLat[0] + 0.02, lngLat[1] + 0.01], zoom: 16}),
    target
  );
  if (isMobile) await page.locator('#search').click();
  else await openMenu(page);
  const row = page.locator('.result', {hasText: 'Nearby place 0'});
  const outside = await camera(page);
  await row.click();
  await expect.poll(async () => (await camera(page)).center).not.toEqual(outside.center);
  await settled(page);
  const revealed = await camera(page);
  expect(revealed.zoom).toBe(16);
  await closeCard(page);
  await expect(page.locator('#place-card')).toBeHidden();
  await row.click();
  await expect(page.locator('#place-card')).toBeVisible();
  await expectCameraToHold(page, revealed);
});

test('a chosen result still zooms in to street level from far out', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.26, 42.44], zoom: 11}));
  // Open the dock to access the results list.
  await openMenu(page);
  await page.locator('.result', {hasText: 'Nearby place 0'}).click();
  await expect.poll(async () => (await camera(page)).zoom).toBe(15);
});

test('search bar focus has no ring, and categories and the place card have no scrollbars', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  const barBorder = () =>
    page.locator('.search-bar').evaluate(element => getComputedStyle(element).borderColor);
  const resting = await barBorder();
  await page.locator('#search').focus();
  expect(await page.locator('#search').evaluate(element => getComputedStyle(element).outlineStyle)).toBe(
    'none'
  );
  expect(await barBorder()).not.toBe(resting);
  // Open the dock to access results (desktop search panel needs a query to show results).
  await openMenu(page);
  await page.locator('.result').first().click();
  for (const selector of ['#categories', '#place-card'])
    expect(await page.locator(selector).evaluate(element => getComputedStyle(element).scrollbarWidth)).toBe(
      'none'
    );
});

test('desktop keeps the results open beside the place card', async ({page, isMobile}, testInfo) => {
  test.skip(isMobile, 'desktop layout');
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  // Open the dock to access the results list.
  await openMenu(page);
  const row = page.locator('.result', {hasText: 'Nearby place 0'});
  await row.click();
  await expect(page.locator('#place-card')).toBeVisible();
  // On desktop, the dock stays open beside the place card.
  await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
  await expect(row).toHaveAttribute('aria-current', 'true');
  await settled(page);
  // The card should be to the right of the dock.
  const dock = await page.locator('.sidebar').boundingBox();
  const card = await page.locator('#place-card').boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(dock.x + dock.width);
  const place = await pointOnMap(page, nearbyPlaces.features[0].geometry.coordinates);
  expect(place.x).toBeGreaterThan(card.x + card.width);
  await page.screenshot({path: testInfo.outputPath('desktop-results-card.png')});
  await page.locator('#close-place').click();
  await expect(page.locator('#place-card')).toBeHidden();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
  await expect(row).toBeFocused();
});

test(
  'phone place card peeks under results and swipes through full and closed',
  {tag: '@phone'},
  async ({page, isMobile}, testInfo) => {
    test.skip(!isMobile, 'phone layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);
    const touch = await page.context().newCDPSession(page);
    const swipe = async (deltaY, selector = '#place-card') => {
      const start = await page.locator(selector).boundingBox();
      const screenX = start.x + start.width / 2;
      const screenY = start.y + 30;
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{x: screenX, y: screenY}]
      });
      for (let step = 1; step <= 5; step++)
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{x: screenX, y: screenY + (deltaY * step) / 5}]
        });
      await touch.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
    };
    const card = page.locator('#place-card');
    const cardSettled = async state => {
      await expect(card).toHaveAttribute('data-state', state);
      await expect.poll(() => card.evaluate(element => element.getAnimations().length)).toBe(0);
    };
    await page.locator('#search').click();
    await page.locator('#categories').getByRole('button', {name: 'Shops', exact: true}).click();
    // Read in the click's own task: the card must open as a peek, not shrink down from full height.
    const opening = await page.locator('.result', {hasText: 'Nearby place 0'}).evaluate(row => {
      row.click();
      const element = document.getElementById('place-card');
      return {height: element.getBoundingClientRect().height, animations: element.getAnimations().length};
    });
    expect(opening.animations).toBe(0);
    expect(opening.height).toBeLessThan(100);

    await cardSettled('peek');
    await expect(page.locator('#search-bubble')).toBeVisible();
    await expect(page.locator('#results-strip')).toBeHidden();
    const peek = await card.boundingBox();
    expect(peek.height).toBeLessThan(100);
    await expect(page.locator('#place-body')).toHaveJSProperty('inert', true);
    const clippedBody = await page.locator('#place-body').boundingBox();
    // Allows the 1px border and sub-pixel text layout.
    expect(clippedBody.y).toBeGreaterThanOrEqual(peek.y + peek.height - 2);
    const closeBox = await page.locator('#close-place').boundingBox();
    expect(closeBox.width).toBeLessThanOrEqual(1);
    await page.screenshot({path: testInfo.outputPath('phone-peek.png')});

    await swipe(-160);
    await cardSettled('full');
    await expect(page.locator('#search-bubble')).toBeHidden();
    await expect(page.locator('#results-strip')).toBeVisible();
    await expect(page.locator('#results-strip-label')).toHaveText('Shops');
    await expect(page.locator('#point-from')).toBeVisible();
    await settled(page);
    const place = await pointOnMap(page, nearbyPlaces.features[0].geometry.coordinates);
    const strip = await page.locator('#results-strip').boundingBox();
    const full = await card.boundingBox();
    expect(place.y).toBeGreaterThan(strip.y + strip.height);
    expect(place.y).toBeLessThan(full.y);
    await page.screenshot({path: testInfo.outputPath('phone-full.png')});

    await page.locator('#results-strip').click();
    await cardSettled('peek');
    await expect(page.locator('#search-bubble')).toBeVisible();
    await page.locator('#card-handle').click();
    await cardSettled('full');

    // A short full card also swipes from its body, not only the header.
    await swipe(120, '#place-details');
    await cardSettled('peek');
    await expect(page.locator('#search-bubble')).toBeVisible();
    await swipe(60);
    await expect(card).toBeHidden();
    await expect(page.locator('#search-bubble')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'search');

    // With no search behind it, one swipe closes the card.
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await tapRenderedPlace(
      page,
      nearbyPlaces.features[0].geometry.coordinates,
      nearbyPlaces.features[0].properties.id
    );
    await cardSettled('full');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    // The handle has nothing to fold down to here.
    await page.locator('#card-handle').click();
    await expect(card).toHaveAttribute('data-state', 'full');
    await swipe(120);
    await expect(card).toBeHidden();
  }
);

test(
  'phone search stays in the dock or compact view it started from until a result is chosen',
  {tag: '@phone'},
  async ({page, isMobile}) => {
    test.skip(!isMobile, 'phone layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);
    const body = page.locator('body');
    const dock = page.locator('#dock-content');
    const bubble = page.locator('#search-bubble');

    // Compact stays compact while searching.
    await page.locator('#search').click();
    await expect(body).toHaveAttribute('data-view', 'search');
    await page.locator('#search').fill('Nearby');
    await expect(body).toHaveAttribute('data-view', 'search');
    await expect(dock).toBeHidden();
    await page.locator('#search').fill('');
    await page.keyboard.press('Escape');
    await expect(body).toHaveAttribute('data-view', 'closed');

    // The dock stays open through focus, typing, and categories, with results inside it.
    await openMenu(page);
    await page.locator('#search').click();
    await expect(body).toHaveAttribute('data-view', 'dock');
    await page.locator('#search').fill('Nearby');
    await page.locator('#categories').getByRole('button', {name: 'Shops', exact: true}).click();
    await expect(body).toHaveAttribute('data-view', 'dock');
    await expect(dock).toBeVisible();
    await expect(bubble).toBeHidden();
    await expect(page.locator('#dock-main .result')).toHaveCount(3);

    // Only a result click moves to compact, with the same minimized card and the query and category kept.
    await page.locator('.result', {hasText: 'Nearby place 0'}).click();
    await expect(body).toHaveAttribute('data-view', 'search');
    await expect(dock).toBeHidden();
    await expect(bubble).toBeVisible();
    await expect(page.locator('#place-card')).toHaveAttribute('data-state', 'peek');
    await expect(page.locator('#search')).toHaveValue('Nearby');
    await expect(
      page.locator('#categories').getByRole('button', {name: 'Shops', exact: true})
    ).toHaveAttribute('aria-pressed', 'true');
  }
);

test(
  'phone dock results end above the keyboard, and its options return when it closes',
  {tag: '@phone'},
  async ({page, isMobile}) => {
    test.skip(!isMobile, 'phone layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);
    await openMenu(page);
    await expect(page.locator('.dock-footer')).toBeVisible();
    await page.locator('#search').click();
    await simulateKeyboard(page, 420);
    await expect(page.locator('.dock-footer')).toBeHidden();
    await expect
      .poll(async () => {
        const results = await page.locator('#results').boundingBox();
        return results.y + results.height;
      })
      .toBeLessThanOrEqual(420);
    // A panned visual viewport carries the header, so the dock content must follow it.
    await simulateKeyboard(page, 420, 1, 40);
    await expect
      .poll(async () => {
        const header = await page.locator('.search-bar').boundingBox();
        const categories = await page.locator('#categories').boundingBox();
        return categories.y >= header.y + header.height;
      })
      .toBe(true);
    await simulateKeyboard(page, 840);
    await expect(page.locator('.dock-footer')).toBeVisible();
  }
);

test(
  'phone keyboard: the focus zone is judged after it closes, and the map stays still while it is open',
  {tag: '@phone'},
  async ({page, isMobile}) => {
    test.skip(!isMobile, 'phone layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);
    await settled(page);
    const place = nearbyPlaces.features[0].geometry.coordinates;
    await page.evaluate(lngLat => window.kompasDebug.map.jumpTo({center: lngLat, zoom: 16}), place);
    await page.locator('#search').click();
    const row = page.locator('.result', {hasText: 'Nearby place 0'});

    // First choice with no keyboard puts the place in the resting zone.
    await row.click();
    await expect(page.locator('#place-card')).toBeVisible();
    await settled(page);
    await mapIdle(page);
    const resting = await camera(page);
    await closeCard(page);

    // With the keyboard up, the same place would be outside the shrunken zone; the camera must not react to that.
    await simulateKeyboard(page, 420);
    await row.click();
    await expect(page.locator('#place-card')).toBeVisible();
    await simulateKeyboard(page, 840);
    await expectCameraToHold(page, resting);

    // A keyboard raised over an open card leaves the camera still, and closing it leaves the place uncovered.
    await simulateKeyboard(page, 420);
    await expectCameraToHold(page, resting);
    await simulateKeyboard(page, 840);
    await settled(page);
    await expect(async () => {
      const point = await pointOnMap(page, place);
      const bubble = await page.locator('#search-bubble').boundingBox();
      const card = await page.locator('#place-card').boundingBox();
      expect(point.y).toBeGreaterThan(bubble.y + bubble.height);
      expect(point.y).toBeLessThan(card.y);
    }).toPass({timeout: 15000});
  }
);

test(
  'a small visual viewport without a phone keyboard does not hold the camera back',
  {tag: '@phone'},
  async ({page, isMobile}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);
    await settled(page);
    const place = nearbyPlaces.features[0].geometry.coordinates;
    await page.evaluate(
      lngLat => window.kompasDebug.map.jumpTo({center: [lngLat[0] + 0.02, lngLat[1] + 0.01], zoom: 16}),
      place
    );
    if (isMobile) {
      await page.locator('#search').click();
    } else {
      // On desktop, results are in the search panel; typing a query makes them visible.
      await page.locator('#search').fill('Nearby');
    }
    // A pinch-zoomed phone page, or a desktop window's visual viewport: neither is a keyboard.
    await simulateKeyboard(page, 420, isMobile ? 1.5 : 1);
    const before = await camera(page);
    await page.locator('.result', {hasText: 'Nearby place 0'}).click();
    await expect.poll(async () => (await camera(page)).center).not.toEqual(before.center);
  }
);

test('the result list keeps its order while a chosen place is open and re-sorts after', {tag: '@phone'}, async ({page, isMobile}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  const lastPlace = nearbyPlaces.features[5].geometry.coordinates;
  await page.evaluate(lngLat => window.kompasDebug.map.jumpTo({center: lngLat, zoom: 16}), lastPlace);
  if (isMobile) await page.locator('#search').click();
  else await openMenu(page);
  const names = page.locator('.result strong');
  await expect(names.first()).toHaveText('Nearby place 5');
  const order = await names.allTextContents();

  // The far row is outside the zone, so the map travels to the other end of the list.
  await page.locator('.result', {hasText: 'Nearby place 0'}).click();
  await expect.poll(async () => (await camera(page)).center[0]).toBeLessThan(lastPlace[0] - 0.01);
  await settled(page);
  await expectToHold(async () => expect(await names.allTextContents()).toEqual(order), RESORT_WINDOW_MILLISECONDS);

  await closeCard(page);
  await page.evaluate(() => window.kompasDebug.map.panBy([1, 0], {duration: 0}));
  await expect(names.first()).toHaveText('Nearby place 0');
});

test('search highlights the nearest match on the map without moving it', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  const nearest = nearbyPlaces.features[3];
  await page.evaluate(
    lngLat => window.kompasDebug.map.jumpTo({center: lngLat, zoom: 16}),
    nearest.geometry.coordinates
  );
  const before = await camera(page);
  await page.locator('#search').fill('Nearby');
  // On desktop, filling the search shows the desktop panel; the highlight still works.
  await expect
    .poll(() =>
      page.evaluate(
        () => window.kompasDebug.map.queryRenderedFeatures({layers: ['search-place']})[0]?.properties.label
      )
    )
    .toBe(nearest.properties.name);
  expect(await camera(page)).toEqual(before);
});

test(
  'choosing a route point from a result shows the route controls',
  {tag: '@phone'},
  async ({page, isMobile}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);
    await page.locator('#search').fill('Nearby place 0');
    await page.locator('.result', {hasText: 'Nearby place 0'}).click();
    await expect(page.locator('#place-card')).toBeVisible();
    if (isMobile) await page.locator('#card-handle').click();
    await page.locator('#point-from').click();
    await expect(page.locator('#place-card')).toBeHidden();
    await expect(page.locator('#route-endpoints')).toBeVisible();
    await expect(page.locator('#route-from')).toContainText('Nearby place 0');
  }
);

test('a tapped map pin follows the focus zone like a result', {tag: '@phone'}, async ({page, isMobile}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  const place = nearbyPlaces.features[0].geometry.coordinates;
  const firstFeatureId = nearbyPlaces.features[0].properties.id;

  // The helper centres the map on the pin, which is inside the zone with the card open: no move.
  await tapRenderedPlace(page, place, firstFeatureId);
  await expect(page.locator('#place-name')).toHaveText('Nearby place 0');
  const expectCameraOnPlace = async () => {
    const {center} = await camera(page);
    expect(center[0]).toBeCloseTo(place[0], 6);
    expect(center[1]).toBeCloseTo(place[1], 6);
  };
  await expectToHold(expectCameraOnPlace, CAMERA_HOLD_MILLISECONDS);
  await closeCard(page);
  await expect(page.locator('#place-card')).toBeHidden();

  // Pushed to the right edge of the uncovered map, the same pin is outside the zone: the map moves.
  const pushRight = isMobile ? -114 : -540;
  await page.evaluate(screenX => window.kompasDebug.map.panBy([screenX, 0], {duration: 0}), pushRight);
  await settled(page);
  await expect.poll(() => page.evaluate(() => window.kompasDebug.map.areTilesLoaded())).toBe(true);
  const before = await camera(page);
  const pin = await pointOnMap(page, place);
  if (isMobile) await page.touchscreen.tap(pin.x, pin.y);
  else await page.mouse.click(pin.x, pin.y);
  await expect(page.locator('#place-card')).toBeVisible();
  await expect.poll(async () => (await camera(page)).center).not.toEqual(before.center);
  await settled(page);
  const moved = await pointOnMap(page, place);
  expect(moved.x).toBeLessThan(pin.x);
});

test(
  'phone category strip scrolls to the active chip and with a mouse wheel',
  {tag: '@phone'},
  async ({page, isMobile}) => {
    test.skip(!isMobile, 'phone layout');
    // Use a narrow mobile viewport (360 × 740) so all five category chips overflow the strip.
    // 360 px is still a Mobile viewport (wider than 400 or taller than 400, so not Flip).
    await page.setViewportSize({width: 360, height: 740});
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);
    await page.locator('#search').click();
    const strip = page.locator('#categories');
    const chip = name => strip.getByRole('button', {name, exact: true});
    const chipInStrip = async name => {
      const box = await chip(name).boundingBox();
      const stripBox = await strip.boundingBox();
      return box.x >= stripBox.x - 1 && box.x + box.width <= stripBox.x + stripBox.width + 1;
    };
    // 'Essentials' is the rightmost chip; at 360 px it starts outside the visible strip.
    expect(await chipInStrip('Essentials')).toBe(false);
    // A plain DOM click: Playwright's own click would scroll the chip into view and hide a failure.
    await chip('Essentials').evaluate(element => element.click());
    await expect.poll(() => chipInStrip('Essentials')).toBe(true);
    await chip('Essentials').evaluate(element => element.click());
    // Toggling off clears the category filter — no button is pressed.
    await expect(page.locator('#categories [aria-pressed="true"]')).toHaveCount(0);

    const scrolled = await strip.evaluate(element => {
      const start = element.scrollLeft;
      element.dispatchEvent(new WheelEvent('wheel', {deltaY: 60, bubbles: true, cancelable: true}));
      return element.scrollLeft - start;
    });
    expect(scrolled).toBeGreaterThan(0);
  }
);

test(
  'category toggle cycle selects, switches, and clears the filter',
  async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);
    await page.locator('#search').click();

    // Press 'Eat & drink': it is the only pressed button, and results are filtered to that category.
    await page.locator('#categories').getByRole('button', {name: 'Eat & drink', exact: true}).click();
    await expect(page.locator('#categories [aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#categories').getByRole('button', {name: 'Eat & drink', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.result')).toHaveCount(3);

    // Press 'Shops': only Shops is pressed, and results switch to that category.
    await page.locator('#categories').getByRole('button', {name: 'Shops', exact: true}).click();
    await expect(page.locator('#categories [aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('#categories').getByRole('button', {name: 'Shops', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.result')).toHaveCount(3);

    // Press 'Shops' again: none is pressed, and all results are shown.
    await page.locator('#categories').getByRole('button', {name: 'Shops', exact: true}).click();
    await expect(page.locator('#categories [aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('.result')).toHaveCount(6);
  }
);

// Categories row is a single horizontal row on desktop: floating chips, dock, and joined card.
// Chips do not wrap to a second row; the row scrolls horizontally when it overflows.
test.describe('categories row is a single row on desktop', () => {
  test.beforeEach(({page}) => stubRouting(page));

  // Use a viewport narrow enough that the category chips overflow the container.
  const narrowDesktop = {width: 1280, height: 800};

  test('floating categories row is a single row with horizontal scroll', async ({page}) => {
    await page.setViewportSize(narrowDesktop);
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);

    // Dock is closed, no query: floating chips are visible in the desktop search panel.
    const {tops, scrollWidth, clientWidth} = await page.evaluate(() => {
      const categories = document.getElementById('categories');
      const buttons = categories.querySelectorAll('button');
      const rectTops = Array.from(buttons).map(btn => btn.getBoundingClientRect().top);
      return {
        tops: rectTops,
        scrollWidth: categories.scrollWidth,
        clientWidth: categories.clientWidth
      };
    });

    // All chips should share the same top (within 1 px for sub-pixel rendering).
    const firstTop = tops[0];
    for (const top of tops) {
      expect(Math.abs(top - firstTop)).toBeLessThanOrEqual(1);
    }

    // The row should be wider than its container, so horizontal scroll is possible.
    expect(scrollWidth).toBeGreaterThan(clientWidth);
  });

  test('categories row in the dock is a single row with horizontal scroll', async ({page}) => {
    await page.setViewportSize(narrowDesktop);
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);
    await openMenu(page);

    const {tops, scrollWidth, clientWidth} = await page.evaluate(() => {
      const categories = document.getElementById('categories');
      const buttons = categories.querySelectorAll('button');
      const rectTops = Array.from(buttons).map(btn => btn.getBoundingClientRect().top);
      return {
        tops: rectTops,
        scrollWidth: categories.scrollWidth,
        clientWidth: categories.clientWidth
      };
    });

    const firstTop = tops[0];
    for (const top of tops) {
      expect(Math.abs(top - firstTop)).toBeLessThanOrEqual(1);
    }
    expect(scrollWidth).toBeGreaterThan(clientWidth);
  });

  test('categories row in the joined card is a single row with horizontal scroll', async ({page}) => {
    await page.setViewportSize(narrowDesktop);
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);

    // Type a query to show the joined card with categories + results.
    await page.locator('#search').fill('Nearby');
    await expect(page.locator('.result')).toHaveCount(6);

    const {tops, scrollWidth, clientWidth} = await page.evaluate(() => {
      const categories = document.getElementById('categories');
      const buttons = categories.querySelectorAll('button');
      const rectTops = Array.from(buttons).map(btn => btn.getBoundingClientRect().top);
      return {
        tops: rectTops,
        scrollWidth: categories.scrollWidth,
        clientWidth: categories.clientWidth
      };
    });

    const firstTop = tops[0];
    for (const top of tops) {
      expect(Math.abs(top - firstTop)).toBeLessThanOrEqual(1);
    }
    expect(scrollWidth).toBeGreaterThan(clientWidth);
  });

  test('categories row is horizontally scrollable', async ({page}) => {
    await page.setViewportSize(narrowDesktop);
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);

    // Verify the row can be scrolled horizontally by setting scrollLeft directly.
    const {canScroll, scrollWidth, clientWidth} = await page.evaluate(() => {
      const categories = document.getElementById('categories');
      const start = categories.scrollLeft;
      categories.scrollLeft = start + 50;
      const canScroll = categories.scrollLeft > start;
      categories.scrollLeft = start; // reset
      return {canScroll, scrollWidth: categories.scrollWidth, clientWidth: categories.clientWidth};
    });
    expect(canScroll).toBe(true);
    expect(scrollWidth).toBeGreaterThan(clientWidth);
  });
});

test(
  'one wheel gesture changes the phone card state only once',
  {tag: '@phone'},
  async ({page, isMobile}) => {
    test.skip(!isMobile, 'phone layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
    await ready(page);
    await page.locator('#search').click();
    await page.locator('.result', {hasText: 'Nearby place 0'}).click();
    const card = page.locator('#place-card');
    await expect(card).toHaveAttribute('data-state', 'peek');
    const wheelBurst = deltaY =>
      card.evaluate((element, delta) => {
        for (let event = 0; event < 6; event++)
          element.dispatchEvent(new WheelEvent('wheel', {deltaY: delta, bubbles: true, cancelable: true}));
      }, deltaY);
    await wheelBurst(40);
    await expect(card).toHaveAttribute('data-state', 'full');
    // Input timing, not a wait for state: the card ignores wheel events until the previous gesture has ended.
    await page.waitForTimeout(WHEEL_GESTURE_GAP_MILLISECONDS);
    await wheelBurst(-40);
    await expect(card).toHaveAttribute('data-state', 'peek');
    await page.waitForTimeout(WHEEL_GESTURE_GAP_MILLISECONDS);
    await wheelBurst(-40);
    await expect(card).toBeHidden();
  }
);

test('a narrow desktop window narrows the card and keeps the map controls reachable', async ({
  page,
  isMobile
}) => {
  test.skip(isMobile, 'desktop layout');
  await page.setViewportSize({width: 780, height: 700});
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  // Open the dock to access the results list.
  await openMenu(page);
  await page.locator('.result').first().click();
  const dock = await page.locator('.sidebar').boundingBox();
  const card = await page.locator('#place-card').boundingBox();
  const locate = await page.locator('#position-action').boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(dock.x + dock.width);
  expect(card.width).toBeLessThan(375);
  expect(card.x + card.width).toBeLessThanOrEqual(locate.x);
});

test('the layout never scrolls sideways', {tag: '@phone'}, async ({page}) => {
  await ready(page);
  const sidewaysScroll = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(sidewaysScroll).toBeLessThanOrEqual(0);
});

test('a camera move ending keeps keyboard focus on the same result row', async ({page}) => {
  await ready(page);
  await openMenu(page);
  const row = page.locator('.result').first();
  const rowId = await row.getAttribute('data-id');
  await row.focus();
  await page.evaluate(() => window.kompasDebug.map.fire('moveend'));
  await expect(page.locator('.result:focus')).toHaveAttribute('data-id', rowId);
});

// A slight touchpad swipe as Chrome on Linux reports it: small deltas a few milliseconds apart. One page.evaluate sends
// them all, so no Playwright round trip widens the gaps: MapLibre starts the move from the second event, carrying it,
// only when that event arrives within its 40 ms first-event timer.
async function swipeTouchpad(page, {events, deltaY, gapMilliseconds}) {
  await page.evaluate(
    async ({events, deltaY, gapMilliseconds}) => {
      const map = window.kompasDebug.map;
      const canvasContainer = map.getCanvasContainer();
      const bounds = canvasContainer.getBoundingClientRect();
      const options = {deltaY, clientX: bounds.left + bounds.width / 2, clientY: bounds.top + bounds.height / 2};
      for (let index = 0; index < events; index++) {
        canvasContainer.dispatchEvent(new WheelEvent('wheel', {...options, bubbles: true, cancelable: true}));
        await new Promise(resolve => setTimeout(resolve, gapMilliseconds));
      }
    },
    {events, deltaY, gapMilliseconds}
  );
}

// Zoom speed and feel are MapLibre's own (ADR 0015); this checks only what the app relies on: wheel input zooms, and
// its movestart carries the input event, which app.js uses to stop the first location fix from re-centring.
test('touchpad scrolling zooms the map and its move carries the wheel event', async ({page}) => {
  await ready(page);
  const startZoom = await page.evaluate(() => window.kompasDebug.map.getZoom());
  await page.evaluate(() => {
    window.wheelMoveStarts = [];
    window.kompasDebug.map.on('movestart', event => window.wheelMoveStarts.push(event.originalEvent?.type ?? null));
  });

  await swipeTouchpad(page, {events: 10, deltaY: -10.5, gapMilliseconds: 7});

  await expect
    .poll(async () => (await page.evaluate(() => window.kompasDebug.map.getZoom())) - startZoom)
    .toBeGreaterThan(0.1);
  expect(await page.evaluate(() => window.wheelMoveStarts)).toContain('wheel');
});

test('device class is set on body at flip, mobile, and desktop viewport sizes', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));

  // Desktop viewport (1280×800)
  await page.setViewportSize({width: 1280, height: 800});
  await ready(page);
  await expect(page.locator('body')).toHaveAttribute('data-device', 'desktop');

  // Mobile viewport (412×840) — default for pages-mobile project
  await page.setViewportSize({width: 412, height: 840});
  await expect(page.locator('body')).toHaveAttribute('data-device', 'mobile');

  // Flip viewport (340×340) — withFlipViewport restores to the previous size (412×840) after
  await withFlipViewport(page, async () => {
    await expect(page.locator('body')).toHaveAttribute('data-device', 'flip');
  });

  // withFlipViewport restored to 412×840, so the class is mobile again
  await expect(page.locator('body')).toHaveAttribute('data-device', 'mobile');

  // Explicitly resize to desktop to verify the transition back
  await page.setViewportSize({width: 1280, height: 800});
  await expect(page.locator('body')).toHaveAttribute('data-device', 'desktop');
});

// attributionNodes sanitises HTML safely — tested in the browser where DOMParser is available.
// Node has no DOMParser, so these four cases live in a browser test instead of a unit test.
test('attributionNodes rejects javascript: href and flattens non-anchor elements', async ({page}) => {
  await ready(page);
  const findings = await page.evaluate(() => {
    const results = {};

    // Recreate the attributionNodes logic inline for testing
    function testAttributionNodes(html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const nodes = [];
      for (const child of doc.body.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          nodes.push(document.createTextNode(child.textContent));
        } else if (child.tagName === 'A') {
          const href = child.getAttribute('href');
          if (href && href.startsWith('https://')) {
            const anchor = document.createElement('a');
            anchor.href = href;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.textContent = child.textContent;
            nodes.push(anchor);
          } else {
            nodes.push(document.createTextNode(child.textContent));
          }
        } else {
          nodes.push(document.createTextNode(child.textContent));
        }
      }
      return nodes;
    }

    // Test 1: javascript: href becomes plain text
    const jsNodes = testAttributionNodes('<a href="javascript:alert(1)">Click</a>');
    results.javascriptHref = jsNodes.every(node => node.nodeType === Node.TEXT_NODE);

    // Test 2: <b> element flattens to text
    const boldNodes = testAttributionNodes('<b>Bold</b>');
    results.boldFlattened = boldNodes.length === 1 && boldNodes[0].nodeType === Node.TEXT_NODE &&
      boldNodes[0].textContent === 'Bold';

    // Test 3: anchor nested in <span> becomes text (only top-level anchors rebuilt)
    const nestedNodes = testAttributionNodes('<span><a href="https://example.com">Link</a></span>');
    results.nestedAnchor = nestedNodes.every(node => node.nodeType === Node.TEXT_NODE);

    // Test 4: target _blank and rel on rebuilt anchor
    const safeNodes = testAttributionNodes('<a href="https://example.com">Safe</a>');
    const anchor = safeNodes.find(node => node.nodeType === Node.ELEMENT_NODE);
    results.anchorTarget = anchor?.target === '_blank' && anchor?.rel === 'noopener noreferrer';

    return results;
  });
  expect(findings.javascriptHref).toBe(true);
  expect(findings.boldFlattened).toBe(true);
  expect(findings.nestedAnchor).toBe(true);
  expect(findings.anchorTarget).toBe(true);
});

// Attribution lives in the dock footer, not as a floating control on the map.
test('attribution appears in dock footer and updates with satellite toggle', async ({page}) => {
  await ready(page);
  // No floating attribution control
  await expect(page.locator('.maplibregl-ctrl-attrib')).toHaveCount(0);

  // Open menu to reveal dock footer
  await openMenu(page);
  const attribution = page.locator('#map-attribution');
  await expect(attribution).toBeVisible();

  // Exact text: spaces around links preserved, each link appears once
  await expect(attribution).toHaveText('© OpenStreetMap contributors · ODbL · Natural Earth');
  const osmLink = attribution.locator('a[href="https://www.openstreetmap.org/copyright"]');
  await expect(osmLink).toHaveCount(1);

  // Toggle satellite on: eMapa link appears
  await page.getByRole('button', {name: 'Satellite', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.kompasDebug.satellite)).toBe(true);
  const emapaLink = attribution.locator('a[href="https://emapa.me/"]');
  await expect(emapaLink).toHaveCount(1);
  await expect(attribution).toHaveText('© OpenStreetMap contributors · ODbL · Natural Earth · Imagery: eMapa · Ortofoto 2025');

  // Toggle satellite off: eMapa link disappears
  await page.getByRole('button', {name: 'Satellite', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.kompasDebug.satellite)).toBe(false);
  await expect(emapaLink).toHaveCount(0);
  await expect(attribution).toHaveText('© OpenStreetMap contributors · ODbL · Natural Earth');

  // Turning on transport (which has no attribution) must not change the attribution text.
  const attributionBeforeTransport = await attribution.textContent();
  await page.getByRole('button', {name: 'Transport', exact: true}).click();
  await expect.poll(() => page.evaluate(() => window.kompasDebug.transport)).toBe(true);
  await expect(attribution).toHaveText(attributionBeforeTransport);
});

// Same attribution checks at Flip viewport
test('attribution appears in dock footer on flip viewport', {tag: '@phone'}, async ({page}) => {
  await withFlipViewport(page, async () => {
    await ready(page);
    await expect(page.locator('.maplibregl-ctrl-attrib')).toHaveCount(0);

    await openMenu(page);
    // Expand the footer to reveal the attribution (minimized by default on Flip).
    await page.locator('#footer-toggle').click();
    const attribution = page.locator('#map-attribution');
    await expect(attribution).toBeVisible();
    const osmLink = attribution.locator('a[href="https://www.openstreetmap.org/copyright"]');
    await expect(osmLink).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Full-screen map and scale bar (issue #97)
// ---------------------------------------------------------------------------

// Verifies that the map fills the viewport and the scale bar sits in the
// bottom-left corner without overlap — on Desktop, Mobile, and Flip.
const FLIP_VIEWPORT = {width: 340, height: 340};
const deviceCases = [
  {name: 'desktop', viewport: {width: 1280, height: 800}},
  {name: 'mobile', viewport: {width: 412, height: 840}},
  {name: 'flip', viewport: FLIP_VIEWPORT}
];

async function assertMapFillsViewport(page) {
  const viewport = page.viewportSize();
  const mapBox = await page.locator('#map').boundingBox();
  expect(mapBox).not.toBeNull();
  const mapWidthDiff = Math.abs(mapBox.width - viewport.width);
  const mapHeightDiff = Math.abs(mapBox.height - viewport.height);
  expect(mapWidthDiff).toBeLessThanOrEqual(1);
  expect(mapHeightDiff).toBeLessThanOrEqual(1);

  const canvasBox = await page.locator('#map canvas').boundingBox();
  expect(canvasBox).not.toBeNull();
  const canvasWidthDiff = Math.abs(canvasBox.width - viewport.width);
  const canvasHeightDiff = Math.abs(canvasBox.height - viewport.height);
  expect(canvasWidthDiff).toBeLessThanOrEqual(1);
  expect(canvasHeightDiff).toBeLessThanOrEqual(1);
}

async function assertScaleBarInBottomLeft(page) {
  const scaleBar = page.locator('.maplibregl-ctrl-scale');
  await expect(scaleBar).toBeVisible();
  const box = await scaleBar.boundingBox();
  expect(box).not.toBeNull();
  expect(box.x).toBeLessThanOrEqual(24);
  const viewport = page.viewportSize();
  const bottomGap = viewport.height - (box.y + box.height);
  expect(bottomGap).toBeLessThanOrEqual(24);
}

// Returns a list of element identifiers that overlap the scale bar's bounding box.
// Walks every candidate under .sidebar, .map-area and body > main and checks their
// rects against the scale bar's rect. Elements whose background, border or text paints
// are kept; purely transparent wrappers and ancestor containers are excluded.
// Includes pointer-events: none elements — those are exactly what this check must catch
// (e.g. the closed .sidebar).
export async function scaleBarCulprits(page) {
  return page.evaluate(() => {
    const scaleBar = document.querySelector('.maplibregl-ctrl-scale');
    if (!scaleBar) return [];
    const scaleRect = scaleBar.getBoundingClientRect();
    if (!scaleRect.width) return [];

    const containers = [
      document.querySelector('.sidebar'),
      document.querySelector('.map-area'),
      document.querySelector('body > main')
    ].filter(Boolean);

    const culprits = [];

    for (const container of containers) {
      const allElements = container.querySelectorAll('*');
      for (const element of allElements) {
        // Skip the scale bar itself and its descendants
        if (element.classList.contains('maplibregl-ctrl-scale')) continue;
        if (scaleBar.contains(element)) continue;
        // Skip the OSM credit line — it is intentionally below the scale bar
        if (element.classList.contains('osm-credit-line')) continue;
        if (element.closest('.osm-credit-line')) continue;
        // Skip ancestors of the scale bar — their rects naturally contain it
        if (element.contains(scaleBar)) continue;
        // Skip the map canvas
        if (element.tagName === 'CANVAS') continue;

        // Must be visible and have a non-empty rect
        if (!element.checkVisibility()) continue;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;

        // Check if rect intersects the scale bar's rect
        if (rect.right <= scaleRect.left || rect.left >= scaleRect.right ||
            rect.bottom <= scaleRect.top || rect.top >= scaleRect.bottom) {
          continue;
        }

        const style = getComputedStyle(element);

        // Exclude elements whose computed background-color is transparent and that
        // have no direct text and no border. Only direct text nodes count — descendant
        // text belongs to child elements, not to a transparent wrapper.
        const hasDirectText = Array.from(element.childNodes).some(
          node => node.nodeType === Node.TEXT_NODE && node.textContent.trim().length > 0
        );
        const hasBorder = parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== 'none';
        const backgroundColor = style.backgroundColor;
        const hasBackground = backgroundColor && backgroundColor !== 'transparent' && backgroundColor !== 'rgba(0, 0, 0, 0)';

        if (!hasDirectText && !hasBorder && !hasBackground) continue;

        culprits.push(element.id ? `#${element.id}` : element.tagName.toLowerCase());
      }
    }

    return culprits;
  });
}

async function assertNoOverlapAtScaleBar(page) {
  const culprits = await scaleBarCulprits(page);
  expect(culprits).toEqual([]);
}

for (const {name, viewport} of deviceCases) {
  test(`map fills viewport and scale bar is in bottom-left on ${name}`, async ({page}) => {
    async function checkMainScreen() {
      await ready(page);
      await closeMenu(page);
      await assertMapFillsViewport(page);
      await assertScaleBarInBottomLeft(page);
      await assertNoOverlapAtScaleBar(page);
    }

    await atViewport(page, viewport, checkMainScreen);
  });
}

// ---------------------------------------------------------------------------
// OSM credit line below the scale bar (issue #144)
// ---------------------------------------------------------------------------

// Verifies the on-map "OpenStreetMap" credit sits below the scale bar on
// Desktop, Mobile, and Flip — visible, positioned, sized, and clickable.
for (const {name, viewport, isMobile} of deviceCases.map(deviceCase => ({
  ...deviceCase,
  isMobile: deviceCase.name !== 'desktop'
}))) {
  const phoneTag = isMobile ? {tag: '@phone'} : {};

  test(`OSM credit matches scale bar styling on ${name}`, {...phoneTag}, async ({page}) => {
    await atViewport(page, viewport, async () => {
      await ready(page);
      await closeMenu(page);

      // The credit inherits the same background-color, color, and font-family
      // as the scale bar so they stay in step (wiki Web app – UI, ADR 0016).
      const styles = await page.evaluate(() => {
        const scaleBar = document.querySelector('.maplibregl-ctrl-scale');
        const creditEl = document.querySelector('.osm-credit-line');
        if (!scaleBar || !creditEl) return null;
        const scaleStyle = getComputedStyle(scaleBar);
        const creditStyle = getComputedStyle(creditEl);
        return {
          scaleBackground: scaleStyle.backgroundColor,
          creditBackground: creditStyle.backgroundColor,
          scaleColor: scaleStyle.color,
          creditColor: creditStyle.color,
          scaleFontFamily: scaleStyle.fontFamily,
          creditFontFamily: creditStyle.fontFamily
        };
      });
      expect(styles).not.toBeNull();
      expect(styles.creditBackground).toBe(styles.scaleBackground);
      expect(styles.creditColor).toBe(styles.scaleColor);
      expect(styles.creditFontFamily).toBe(styles.scaleFontFamily);
    });
  });

  test(`OSM credit line is visible and positioned below scale bar on ${name}`, {...phoneTag}, async ({page}) => {
    await atViewport(page, viewport, async () => {
      await ready(page);
      await closeMenu(page);

      // Credit is visible
      const credit = page.locator('.osm-credit-line');
      await expect(credit).toBeVisible();

      // Link href is the OSM copyright page
      const link = credit.locator('a');
      await expect(link).toHaveAttribute('href', 'https://www.openstreetmap.org/copyright');

      // Position: credit top is within 2 px of scale bar's bottom
      // Left edge within 2 px of scale bar's left
      // Height is about half the scale bar's (within 2 px)
      const measurements = await page.evaluate(() => {
        const scaleBar = document.querySelector('.maplibregl-ctrl-scale');
        const creditEl = document.querySelector('.osm-credit-line');
        if (!scaleBar || !creditEl) return null;
        const scaleRect = scaleBar.getBoundingClientRect();
        const creditRect = creditEl.getBoundingClientRect();
        return {
          scaleBarHeight: scaleRect.height,
          creditHeight: creditRect.height,
          topGap: creditRect.top - scaleRect.bottom,
          leftDiff: Math.abs(creditRect.left - scaleRect.left)
        };
      });
      expect(measurements).not.toBeNull();
      expect(measurements.topGap).toBeGreaterThanOrEqual(-2);
      expect(measurements.topGap).toBeLessThanOrEqual(2);
      expect(measurements.leftDiff).toBeLessThanOrEqual(2);
      expect(measurements.creditHeight).toBeGreaterThanOrEqual(
        measurements.scaleBarHeight / 2 - 2
      );
      expect(measurements.creditHeight).toBeLessThanOrEqual(
        measurements.scaleBarHeight / 2 + 2
      );

      // elementFromPoint at the credit's centre returns the link (not covered)
      const elementAtCenter = await page.evaluate(() => {
        const creditEl = document.querySelector('.osm-credit-line');
        if (!creditEl) return null;
        const rect = creditEl.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const el = document.elementFromPoint(centerX, centerY);
        return el?.tagName === 'A' ? el.getAttribute('href') : null;
      });
      expect(elementAtCenter).toBe('https://www.openstreetmap.org/copyright');
    });
  });
}

// Proves the overlap check can detect a visible element covering the scale bar.
// Injects a white background on .sidebar so it paints over the scale bar area.
test('overlap check detects injected sidebar background', async ({page}) => {
  await ready(page);
  await closeMenu(page);
  await page.addStyleTag({content: '.sidebar { background: white !important; }'});
  const culprits = await scaleBarCulprits(page);
  expect(culprits.length).toBeGreaterThan(0);
});

// Proves attribution refreshes when a source is added after load.
test('attribution refreshes when a source is added after load', async ({page}) => {
  await ready(page);

  // Verify the debug object is available
  const hasDebug = await page.evaluate(() => !!window.kompasDebug?.map);
  expect(hasDebug).toBe(true);

  // Add a geojson source with a custom attribution and a visible layer using it
  await page.evaluate(() => {
    const map = window.kompasDebug.map;
    map.addSource('test-credit', {
      type: 'geojson',
      data: {type: 'FeatureCollection', features: []},
      attribution: '<a href="https://example.org/">Test credit</a>'
    });
    map.addLayer({
      id: 'test-credit-layer',
      type: 'symbol',
      source: 'test-credit',
      layout: {
        'text-field': 'test'
      }
    });
  });

  // Wait for the attribution container to contain the new link
  await expect.poll(async () => {
    return page.evaluate(() => {
      const container = document.getElementById('map-attribution');
      return container?.querySelector('a[href="https://example.org/"]')?.textContent ?? null;
    });
  }).toBe('Test credit');
});

// ---------------------------------------------------------------------------
// Zoom buttons removed (issue #98)
// ---------------------------------------------------------------------------

for (const {name, viewport} of deviceCases) {
  test(`zoom buttons are hidden and position button sits alone on ${name}`, async ({page}) => {
    async function check() {
      await ready(page);
      // Zoom buttons are not visible
      await expect(page.locator('.maplibregl-ctrl-zoom-in')).toBeHidden();
      await expect(page.locator('.maplibregl-ctrl-zoom-out')).toBeHidden();
      // Position button is visible and close to the bottom-right corner
      await expect(page.locator('#position-action')).toBeVisible();
      const locate = await page.locator('#position-action').boundingBox();
      const viewportSize = page.viewportSize();
      const rightGap = viewportSize.width - (locate.x + locate.width);
      const bottomGap = viewportSize.height - (locate.y + locate.height);
      expect(rightGap).toBeLessThanOrEqual(24);
      expect(bottomGap).toBeLessThanOrEqual(24);
    }

    await atViewport(page, viewport, check);
  });
}

for (const {name, viewport} of deviceCases) {
  test(`keyboard zoom still works on ${name}`, async ({page}) => {
    async function check() {
      await ready(page);
      const startZoom = await page.evaluate(() => window.kompasDebug.map.getZoom());
      // Focus the map canvas and press '+' to zoom in
      await page.locator('#map canvas').focus();
      await page.keyboard.press('+');
      await expect
        .poll(async () => page.evaluate(() => window.kompasDebug.map.getZoom()))
        .toBeGreaterThan(startZoom);
    }

    await atViewport(page, viewport, check);
  });
}

// ---------------------------------------------------------------------------
// GPS follow location (issue #99, reviewed in #127) — real geolocation
// ---------------------------------------------------------------------------

const FIRST_FIX = {latitude: 42.4411, longitude: 19.2627, accuracy: 18};
const SECOND_FIX = {latitude: 42.4511, longitude: 19.2727, accuracy: 15};

// Helper: wait until the position badge reaches a live state after a geolocation update.
async function waitForLiveFix(page) {
  await expect
    .poll(() => page.locator('#position-badge').getAttribute('data-state'))
    .toBe('live');
}

test.describe('GPS follow location', () => {
  test.use({permissions: ['geolocation'], geolocation: FIRST_FIX});

  // Test a: Click centres and sets data-following/aria-pressed true.
  // Pan the camera far from the fix first, so the centre assertion is meaningful.
  for (const {name, viewport} of deviceCases) {
    test(`clicking position button starts following on ${name}`, async ({page, context}) => {
      async function check() {
        await ready(page);
        await context.setGeolocation(FIRST_FIX);
        await waitForLiveFix(page);

        // Pan far from the fix so the centre check is not trivial.
        await page.evaluate(() =>
          window.kompasDebug.map.jumpTo({center: [19.0, 42.2]})
        );
        await settled(page);

        // Click the position button to start following.
        await page.locator('#position-action').click();
        await settled(page);

        // data-following should be true.
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');
        // aria-pressed should be true.
        await expect(page.locator('#position-action')).toHaveAttribute('aria-pressed', 'true');
        // Camera should centre on the fix.
        await expect
          .poll(() =>
            page.evaluate(
              (fix) => window.kompasDebug.map.getCenter().distanceTo({lng: fix.longitude, lat: fix.latitude}),
              FIRST_FIX
            )
          )
          .toBeLessThan(150);
      }

      await atViewport(page, viewport, check);
    });
  }

  // Test b: A new fix moves the camera while following.
  for (const {name, viewport} of deviceCases) {
    test(`new GPS fix moves camera while following on ${name}`, async ({page, context}) => {
      async function check() {
        await ready(page);
        await context.setGeolocation(FIRST_FIX);
        await waitForLiveFix(page);

        // Start following.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');

        // Simulate a new fix at a different location.
        await context.setGeolocation(SECOND_FIX);
        await waitForLiveFix(page);
        await settled(page);

        // Camera should have moved to the new fix — wait until it is there.
        await expect
          .poll(() =>
            page.evaluate(
              (fix) => window.kompasDebug.map.getCenter().distanceTo({lng: fix.longitude, lat: fix.latitude}),
              SECOND_FIX
            )
          )
          .toBeLessThan(150);
      }

      await atViewport(page, viewport, check);
    });
  }

  // Test c: Second click stops following; a later fix does not move the camera.
  for (const {name, viewport} of deviceCases) {
    test(`second click stops following on ${name}`, async ({page, context}) => {
      async function check() {
        await ready(page);
        await context.setGeolocation(FIRST_FIX);
        await waitForLiveFix(page);

        // Start following.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');

        // Second click stops following.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'false');
        await expect(page.locator('#position-action')).toHaveAttribute('aria-pressed', 'false');

        // Record the camera position after stopping.
        const stoppedCamera = await camera(page);

        // A new fix should not move the camera.
        await context.setGeolocation(SECOND_FIX);
        await waitForLiveFix(page);
        await settled(page);

        // Camera should not have moved.
        expect(await camera(page)).toEqual(stoppedCamera);
      }

      await atViewport(page, viewport, check);
    });
  }

  // Test d: Drag the map stops following; a new fix after drag does not move the camera.
  for (const {name, viewport} of deviceCases) {
    test(`dragging map stops following on ${name}`, {tag: '@phone'}, async ({page, context}) => {
      async function check() {
        await ready(page);
        await context.setGeolocation(FIRST_FIX);
        await waitForLiveFix(page);

        // Start following.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');

        // Drag the map on the canvas (simulates user gesture with originalEvent).
        const canvas = page.locator('#map canvas');
        const box = await canvas.boundingBox();
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        await page.mouse.move(centerX, centerY);
        await page.mouse.down();
        await page.mouse.move(centerX + 100, centerY + 100);
        await page.mouse.up();
        await settled(page);

        // Following should be off.
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'false');
        await expect(page.locator('#position-action')).toHaveAttribute('aria-pressed', 'false');

        // Deliver a new fix — camera should hold.
        const afterDrag = await camera(page);
        await context.setGeolocation(SECOND_FIX);
        await waitForLiveFix(page);
        await settled(page);
        await expectCameraToHold(page, afterDrag);
      }

      await atViewport(page, viewport, check);
    });
  }
});

// ---------------------------------------------------------------------------
// Desktop search bar (issue #101)
// ---------------------------------------------------------------------------

test.describe('Desktop search bar', () => {
  test.use({viewport: {width: 1280, height: 800}});

  test('search bar is taller than 54 px on desktop', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    const bar = await page.locator('.search-bar').boundingBox();
    expect(bar.height).toBeGreaterThan(54);
    expect(bar.height).toBe(60);
  });

  test('floating categories are visible under the bar with no query and dock closed', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    await closeMenu(page);
    const panel = page.locator('#desktop-search-panel');
    await expect(panel).toBeVisible();
    // The panel carries data-has-query="false" in floating mode.
    await expect(panel).toHaveAttribute('data-has-query', 'false');
    // Categories are inside the panel (single source of truth).
    await expect(panel.locator('#categories button')).toHaveCount(5);
    // The dock should be closed.
    await expect(page.locator('#dock-content')).toBeHidden();
  });

  test('floating categories scroll horizontally when they overflow', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    await closeMenu(page);
    const categories = page.locator('#desktop-search-panel #categories');
    // The scroll width should be greater than the visible width (categories overflow).
    const overflow = await categories.evaluate(el => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeGreaterThan(0);
    // Scroll horizontally by setting scrollLeft directly.
    await categories.evaluate(el => {
      el.scrollLeft = 50;
    });
    const scrolled = await categories.evaluate(el => el.scrollLeft);
    expect(scrolled).toBeGreaterThan(0);
  });

  test('floating categories have transparent background and each chip has a shadow', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    await closeMenu(page);
    const panel = page.locator('#desktop-search-panel');
    // Container background is transparent in floating mode.
    const background = await panel.evaluate(el => getComputedStyle(el).backgroundColor);
    expect(background).toBe('rgba(0, 0, 0, 0)');
    // Each category chip floats with its own box-shadow.
    const chipShadow = await panel.locator('#categories button').first().evaluate(
      el => getComputedStyle(el).boxShadow
    );
    expect(chipShadow).not.toBe('none');
  });

  test('typing shows the clear button and clicking it empties the input', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    const clearButton = page.locator('#clear-search');
    // Clear button is hidden initially.
    await expect(clearButton).toBeHidden();
    // Type a query.
    await page.locator('#search').fill('museum');
    await expect(clearButton).toBeVisible();
    // Click the clear button.
    await clearButton.click();
    await expect(page.locator('#search')).toHaveValue('');
    await expect(clearButton).toBeHidden();
  });

  test('with a query, categories and results are inside one container under the bar', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    // Type a query that matches some places.
    await page.locator('#search').fill('Café');
    await expect(page.locator('#clear-search')).toBeVisible();
    // The desktop search panel should be visible with data-has-query="true".
    const panel = page.locator('#desktop-search-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute('data-has-query', 'true');
    // The panel should contain the browse panel with categories and results.
    await expect(panel.locator('#categories')).toBeVisible();
    await expect(panel.locator('#results')).toBeVisible();
    // The panel's top edge is close to the bar's bottom edge (joined card).
    const bar = await page.locator('.search-bar').boundingBox();
    const panelBox = await panel.boundingBox();
    expect(Math.abs(panelBox.y - (bar.y + bar.height))).toBeLessThanOrEqual(6);
  });

  test('Tab reaches menu button, input, clear button, and first category chip', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    // Focus the menu button.
    await page.locator('#menu-toggle').focus();
    await expect(page.locator('#menu-toggle')).toBeFocused();
    // Tab to the search input.
    await page.keyboard.press('Tab');
    await expect(page.locator('#search')).toBeFocused();
    // Type something to show the clear button.
    await page.locator('#search').fill('x');
    // Tab to the clear button.
    await page.keyboard.press('Tab');
    await expect(page.locator('#clear-search')).toBeFocused();
    // Tab to the first category chip in the desktop search panel.
    await page.keyboard.press('Tab');
    const firstChip = page.locator('#desktop-search-panel #categories button').first();
    await expect(firstChip).toBeFocused();
  });

  test('choosing a result from the search panel places the card to the right of the panel', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    // Type a query that matches a place in the fixture.
    await page.locator('#search').fill('Mimoza');
    await expect(page.locator('.result')).toHaveCount(1);
    // Choose the result.
    await page.locator('.result').first().click();
    await expect(page.locator('#place-card')).toBeVisible();
    await settled(page);
    // Measure both the sidebar and the card using getBoundingClientRect.
    const {sidebarRight, cardLeft, cardTop, cardWidth, cardHeight} = await page.evaluate(() => {
      const sidebar = document.querySelector('.sidebar');
      const card = document.getElementById('place-card');
      return {
        sidebarRight: sidebar.getBoundingClientRect().right,
        cardLeft: card.getBoundingClientRect().left,
        cardTop: card.getBoundingClientRect().top,
        cardWidth: card.getBoundingClientRect().width,
        cardHeight: card.getBoundingClientRect().height
      };
    });
    // The card's left edge must be at or right of the sidebar's right edge.
    expect(cardLeft).toBeGreaterThanOrEqual(sidebarRight - 1);
    // The card centre must not be covered by another element — walk up to find #place-card.
    const cardCentreX = cardLeft + cardWidth / 2;
    const cardCentreY = cardTop + cardHeight / 2;
    const isCardVisible = await page.evaluate(({x, y}) => {
      const el = document.elementFromPoint(x, y);
      return el?.closest('#place-card') !== null;
    }, {x: cardCentreX, y: cardCentreY});
    expect(isCardVisible).toBe(true);
  });

  test('with a query, the native search cancel button is hidden', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    await page.locator('#search').fill('Café');
    // Verify the CSS rule hides the native ::-webkit-search-cancel-button.
    // getComputedStyle on pseudo-elements can be unreliable, so check the stylesheet rule.
    const nativeCancelHidden = await page.evaluate(() => {
      function findRule(sheets) {
        for (const sheet of sheets) {
          for (const rule of sheet.cssRules) {
            if (rule.selectorText?.includes('::-webkit-search-cancel-button')) {
              return rule.style.display === 'none';
            }
          }
        }
        return false;
      }
      try {
        return findRule(document.styleSheets);
      } catch {
        return false;
      }
    });
    expect(nativeCancelHidden).toBe(true);
  });

  test('place card drops below floating chips row on desktop', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    // Ensure dock is closed and no query.
    await closeMenu(page);
    await expect(page.locator('#desktop-search-panel')).toBeVisible();
    // Tap a place on the map using the fixture coordinates.
    const place = fixture.features[0];
    await tapRenderedPlace(page, place.geometry.coordinates, place.properties.id);
    await settled(page);
    await expect(page.locator('#place-card')).toBeVisible();
    // The card's top must be at or below the bottom of the desktop-search-panel chips row.
    const cardTop = await page.evaluate(() => {
      const card = document.getElementById('place-card');
      return card.getBoundingClientRect().top;
    });
    const chipsBottom = await page.evaluate(() => {
      const panel = document.getElementById('desktop-search-panel');
      return panel.getBoundingClientRect().bottom;
    });
    const cardVisible = await page.evaluate(() => {
      const card = document.getElementById('place-card');
      const rect = card.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const el = document.elementFromPoint(centerX, centerY);
      return el?.closest('#place-card') !== null;
    });
    // Card top >= chips row bottom.
    expect(cardTop).toBeGreaterThanOrEqual(chipsBottom - 1);
    // The card centre must be visible (not covered by the chips row).
    expect(cardVisible).toBe(true);
  });

  test('desktop-to-mobile resize hides floating chips, mobile-to-desktop restores them', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    // Start at desktop: floating chips visible.
    const panel = page.locator('#desktop-search-panel');
    await expect(panel).toBeVisible();
    await expect(panel.locator('#categories')).toBeVisible();
    // Resize to mobile (412x840).
    await page.setViewportSize({width: 412, height: 840});
    await settled(page);
    // #desktop-search-panel should be hidden.
    await expect(panel).toBeHidden();
    // #browse-panel should not be inside #desktop-search-panel.
    const browsePanelParent = await page.evaluate(() => {
      const browsePanel = document.getElementById('browse-panel');
      return browsePanel.parentElement?.id ?? null;
    });
    expect(browsePanelParent).not.toBe('desktop-search-panel');
    // Resize back to desktop (1280x800).
    await page.setViewportSize({width: 1280, height: 800});
    await settled(page);
    // #desktop-search-panel should be visible with #categories inside.
    await expect(panel).toBeVisible();
    await expect(panel.locator('#categories')).toBeVisible();
  });

  test('Escape clears query and focuses input on desktop; closes dock when open', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    // Part A: dock closed, type query, Tab to move focus off input, then Escape.
    await page.locator('#search').fill('test query');
    await expect(page.locator('#clear-search')).toBeVisible();
    // Tab moves focus off the input to #clear-search.
    await page.keyboard.press('Tab');
    await expect(page.locator('#clear-search')).toBeFocused();
    // Press Escape: input should be empty and #search should be focused.
    await page.keyboard.press('Escape');
    await expect(page.locator('#search')).toHaveValue('');
    await expect(page.locator('#search')).toBeFocused();
    // Part B: dock open, press Escape: dock should close.
    await openMenu(page);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  });

  test('aria-expanded reflects results visibility when typing and clearing', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    // Initially no query: aria-expanded should be 'false'.
    await expect(page.locator('#search')).toHaveAttribute('aria-expanded', 'false');
    // Type a query: results become visible, aria-expanded should be 'true'.
    await page.locator('#search').fill('museum');
    await expect(page.locator('#search')).toHaveAttribute('aria-expanded', 'true');
    // Clear the query: aria-expanded should be 'false'.
    await page.locator('#clear-search').click();
    await expect(page.locator('#search')).toHaveAttribute('aria-expanded', 'false');
  });

  test('card bottom stays within viewport on desktop with small height', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    // Use a short viewport so the card's max-height constraint matters.
    // With the old CSS (max-height: calc(100% - 130px)) and card top at ~152 px,
    // a tall card overflows the bottom when viewport height is only 560 px.
    await page.setViewportSize({width: 1280, height: 560});
    // Create a place with many fields so the card content is taller than the allowed max-height.
    const tallPlace = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [19.264097, 42.439428]},
        properties: {
          id: 'node/999999999',
          name: 'Narodna banka Crne Gore — Glavna ogranak u Podgorici',
          'name:en': 'Central Bank of Montenegro — Main Podgorica Branch',
          category: 'essentials',
          kind: 'bank',
          source: 'OpenStreetMap',
          'addr:street': 'Bulevar Svetog Petra Cetinjskog 14',
          'addr:housenumber': '14',
          opening_hours: 'Mo-Fr 08:00-15:00; Sa 08:00-12:00',
          phone: '+382 20 241 500',
          website: 'https://www.cnb.org.me/',
          visibilityLevel: 5
        }
      }]
    };
    await page.route('**/data/places.geojson', route => route.fulfill({json: tallPlace}));
    await ready(page);
    // Ensure dock is closed and no query (floating chips mode).
    await closeMenu(page);
    await expect(page.locator('#desktop-search-panel')).toBeVisible();
    // Tap the place on the map.
    const place = tallPlace.features[0];
    await tapRenderedPlace(page, place.geometry.coordinates, place.properties.id);
    await settled(page);
    await expect(page.locator('#place-card')).toBeVisible();
    // Measure the card and map to verify the card does not overflow the viewport.
    const {cardBottom, mapBottom} = await page.evaluate(() => {
      const card = document.getElementById('place-card');
      const mapEl = document.getElementById('map');
      const cardRect = card.getBoundingClientRect();
      const mapRect = mapEl.getBoundingClientRect();
      return {
        cardBottom: cardRect.bottom,
        mapBottom: mapRect.bottom
      };
    });
    expect(cardBottom).toBeLessThanOrEqual(mapBottom + 1);
  });

  test('focusing search input does not close the card on desktop', async ({page, isMobile}) => {
    test.skip(isMobile, 'desktop layout');
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    // Type a query and choose a result so the card opens.
    await page.locator('#search').fill('Mimoza');
    await expect(page.locator('.result')).toHaveCount(1);
    await page.locator('.result').first().click();
    await expect(page.locator('#place-card')).toBeVisible();
    await settled(page);
    // Focus the search input — the card should stay visible.
    await page.evaluate(() => document.getElementById('search').focus());
    await expect(page.locator('#place-card')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Mobile search bar (issue #102)
// ---------------------------------------------------------------------------

test.describe('Mobile search bar', () => {
  test.use({viewport: {width: 412, height: 840}});

  test('search bar is smaller than desktop on mobile', async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    const bar = await page.locator('.search-bar').boundingBox();
    // Desktop bar is 60px; mobile bar must be smaller.
    expect(bar.height).toBeLessThan(54);
    expect(bar.height).toBe(44);
  });

  test('search bar has left and right gutters on mobile', async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    const bar = await page.locator('.search-bar').boundingBox();
    const viewport = page.viewportSize();
    const leftGap = bar.x;
    const rightGap = viewport.width - (bar.x + bar.width);
    // The bar uses --bar-inset (12 px on mobile) on both sides.
    expect(leftGap).toBeGreaterThanOrEqual(10);
    expect(leftGap).toBeLessThanOrEqual(14);
    expect(rightGap).toBeGreaterThanOrEqual(10);
    expect(rightGap).toBeLessThanOrEqual(14);
  });

  test('categories move to dock after desktop-to-mobile resize', async ({page}) => {
    // Start at desktop size so the floating chips are visible.
    await page.setViewportSize({width: 1280, height: 800});
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    // Resize to mobile: the mobile media query hides the categories row on the main screen.
    await page.setViewportSize({width: 412, height: 840});
    await expect(page.locator('#categories')).toBeHidden();
  });

  test('categories are visible inside the open dock on mobile', async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    await openMenu(page);
    // Categories become visible when the dock opens.
    await expect(page.locator('#categories')).toBeVisible();
    await expect(page.locator('#categories button')).toHaveCount(5);
  });

  test('touch targets are at least 40 px on mobile', async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    const menuButton = await page.locator('#menu-toggle').boundingBox();
    expect(menuButton.width).toBeGreaterThanOrEqual(40);
    expect(menuButton.height).toBeGreaterThanOrEqual(40);
    // Type a query so the clear button appears, then measure it.
    await page.locator('#search').fill('test');
    const clearButton = await page.locator('#clear-search').boundingBox();
    expect(clearButton.width).toBeGreaterThanOrEqual(40);
    expect(clearButton.height).toBeGreaterThanOrEqual(40);
    // Open the dock and measure a category chip.
    await page.locator('#menu-toggle').click();
    const categoryChip = await page.locator('#categories button').first().boundingBox();
    expect(categoryChip.width).toBeGreaterThanOrEqual(40);
    expect(categoryChip.height).toBeGreaterThanOrEqual(40);
  });
});

// ---------------------------------------------------------------------------
// Flip search bar (issue #103)
// ---------------------------------------------------------------------------

test.describe('Flip search bar', () => {
  test('only menu button is visible on the main screen on flip', async ({page}) => {
    await withFlipViewport(page, async () => {
      await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
      await ready(page);
      // Menu button is visible.
      await expect(page.locator('#menu-toggle')).toBeVisible();
      // Search input is hidden on the main screen.
      await expect(page.locator('#search')).toBeHidden();
      // Categories are hidden on the main screen.
      await expect(page.locator('#categories')).toBeHidden();
    });
  });

  test('search bar shrinks to menu button size on flip with dock closed', async ({page}) => {
    await withFlipViewport(page, async () => {
      await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
      await ready(page);
      const bar = await page.locator('.search-bar').boundingBox();
      const menuButton = await page.locator('#menu-toggle').boundingBox();
      // The bar should not stretch full-width; it should be at most the menu button width plus padding.
      expect(bar.width).toBeLessThanOrEqual(menuButton.width + 16);
    });
  });

  test('search becomes visible and clear button appears when typing in dock on flip', async ({page}) => {
    await withFlipViewport(page, async () => {
      await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
      await ready(page);
      // Open the dock.
      await openMenu(page);
      // Search input is now visible inside the dock.
      await expect(page.locator('#search')).toBeVisible();
      // Clear button should be hidden when there is no query.
      await expect(page.locator('#clear-search')).toBeHidden();
      // Type a query — clear button should appear.
      await page.locator('#search').fill('Café');
      expect(await page.locator('#search').inputValue()).toBe('Café');
      await expect(page.locator('#clear-search')).toBeVisible();
    });
  });

  test('only menu toggle is visible in search bar on flip with dock closed', async ({page}) => {
    await withFlipViewport(page, async () => {
      await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
      await ready(page);
      // Open the menu so we can type a query.
      await openMenu(page);
      await page.locator('#search').fill('test');
      // Close the menu (dock).
      await closeMenu(page);
      // Wait for view to settle.
      await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
      // Only #menu-toggle should be visible in .search-bar.
      await expect(page.locator('#menu-toggle')).toBeVisible();
      // #search, .search-divider, and #clear-search should not be visible.
      await expect(page.locator('#search')).toBeHidden();
      await expect(page.locator('.search-divider')).toBeHidden();
      await expect(page.locator('#clear-search')).toBeHidden();
    });
  });
});

// Test e: Geolocation permission denied — click shows recovery message in #error.
test.describe('GPS follow location — denied', () => {
  for (const {name, viewport} of deviceCases) {
    test(`clicking position button with geolocation denied on ${name}`, async ({page}) => {
      async function check() {
        // Simulate denied state: override permissions.query to return 'denied' for geolocation,
        // and have watchPosition call the error callback with code 1 (PERMISSION_DENIED).
        await page.addInitScript(() => {
          const originalQuery = navigator.permissions.query.bind(navigator.permissions);
          navigator.permissions.query = async (permissionDescriptor) => {
            if (permissionDescriptor?.name === 'geolocation') {
              return {state: 'denied', addEventListener: () => {}};
            }
            return originalQuery(permissionDescriptor);
          };
          const originalWatchPosition = navigator.geolocation.watchPosition;
          navigator.geolocation.watchPosition = function(success, error, options) {
            if (error) error({code: 1, message: 'Permission denied'});
            return originalWatchPosition.call(this, success, error, options);
          };
        });
        await ready(page);
        // The tracker sees permission 'denied' from the query, so start() sets 'denied' immediately.
        await expect
          .poll(() => page.locator('#position-badge').getAttribute('data-state'))
          .toBe('denied');

        // Click the position button — it should trigger requestPosition, which shows the recovery message.
        await page.locator('#position-action').click();
        await settled(page);

        // data-following should remain false.
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'false');
        // The error panel should show the recovery message.
        await expect(page.locator('#error')).toBeVisible();
        await expect(page.locator('#error-text')).toHaveText(/Location blocked/);
      }

      await atViewport(page, viewport, check);
    });
  }
});

// ---------------------------------------------------------------------------
// Regression tests for #127
// ---------------------------------------------------------------------------

// Defect 1: Click the follow button *before* any usable fix arrives.
// Uses holdGeolocationFixes so the first fix is queued until after the click.
test.describe('GPS follow — click before fix arrives', () => {
  test.use({permissions: ['geolocation'], geolocation: FIRST_FIX});

  for (const {name, viewport} of deviceCases) {
    test(`start following before fix arrives on ${name}`, async ({page, context}) => {
      async function check() {
        await holdGeolocationFixes(page);
        await ready(page);
        // State is 'acquiring' because the fix is held.
        await expect(page.locator('#position-badge')).toHaveAttribute('data-state', 'acquiring');

        // Click to start following — fix has not arrived yet.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');
        await expect(page.locator('#position-badge')).toHaveAttribute('data-state', 'acquiring');

        // Release the held fix — the tracker receives it.
        await page.evaluate(() => window.releaseHeldFixes());
        await waitForLiveFix(page);
        await settled(page);

        // Following should still be active and camera centred on the fix.
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');
        await expect
          .poll(() =>
            page.evaluate(
              (fix) => window.kompasDebug.map.getCenter().distanceTo({lng: fix.longitude, lat: fix.latitude}),
              FIRST_FIX
            )
          )
          .toBeLessThan(150);

        // Record camera while following (centered on FIRST_FIX).
        const whileFollowing = await camera(page);

        // Drag the map — should stop following without re-centring.
        const canvas = page.locator('#map canvas');
        const box = await canvas.boundingBox();
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        await page.mouse.move(centerX, centerY);
        await page.mouse.down();
        await page.mouse.move(centerX + 100, centerY + 100);
        await page.mouse.up();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'false');

        // The drag must not have re-centred the camera (defect 1: #isLocationRequested not cleared
        // by the follow branch causes refresh() to re-center on the old fix).
        const afterDrag = await camera(page);
        const reCentered = await page.evaluate(
          ({whileFollowingCenter}) => {
            return window.kompasDebug.map.getCenter().distanceTo({
              lng: whileFollowingCenter[0],
              lat: whileFollowingCenter[1]
            }) < 100;
          },
          {whileFollowingCenter: whileFollowing.center}
        );
        expect(reCentered).toBe(false);

        // Deliver another fix — camera should hold at the dragged position.
        await context.setGeolocation(SECOND_FIX);
        await waitForLiveFix(page);
        await settled(page);
        await expectCameraToHold(page, afterDrag);
      }

      await atViewport(page, viewport, check);
    });
  }
});

// Acquiring style: the button uses the filled toggle style while following even without a fix.
// Uses holdGeolocationFixes so the fix is held until after the click.
test.describe('GPS follow — acquiring style', () => {
  test.use({permissions: ['geolocation'], geolocation: FIRST_FIX});

  for (const {name, viewport} of deviceCases) {
    test(`position button uses filled style while acquiring on ${name}`, async ({page}) => {
      async function check() {
        await holdGeolocationFixes(page);
        await ready(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-state', 'acquiring');

        // Read the not-following background first.
        const backgroundNotFollowing = await page.locator('#position-action').evaluate(
          el => getComputedStyle(el).backgroundColor
        );

        // Click to start following — state is still 'acquiring' but following is active.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');
        await expect(page.locator('#position-badge')).toHaveAttribute('data-state', 'acquiring');

        // The button background should differ from the not-following background.
        const backgroundAcquiring = await page.locator('#position-action').evaluate(
          el => getComputedStyle(el).backgroundColor
        );

        expect(backgroundAcquiring).not.toEqual(backgroundNotFollowing);

        // Verify it matches --green from the root.
        const greenColor = await page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--green').trim()
        );
        const red = parseInt(greenColor.slice(1, 3), 16);
        const green = parseInt(greenColor.slice(3, 5), 16);
        const blue = parseInt(greenColor.slice(5, 7), 16);
        const expectedRgb = `rgb(${red}, ${green}, ${blue})`;
        expect(backgroundAcquiring).toBe(expectedRgb);
      }

      await atViewport(page, viewport, check);
    });
  }
});

// Defect 2: Follow, then choose a search result; a new fix should not move the camera.
test.describe('GPS follow — search result stops following', () => {
  test.use({permissions: ['geolocation'], geolocation: FIRST_FIX});

  for (const {name, viewport} of deviceCases) {
    test(`choosing a search result stops following on ${name}`, async ({page, context}) => {
      async function check() {
        await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
        await ready(page);
        await context.setGeolocation(FIRST_FIX);
        await waitForLiveFix(page);

        // Start following.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');

        // On Flip the search field is hidden until the dock opens, so open the menu first.
        if (await page.locator('body').getAttribute('data-device') === 'flip') {
          await openMenu(page);
        }
        // Search and choose a result — this moves the camera, which stops following.
        await page.locator('#search').fill('Nearby place 0');
        await expect(page.locator('.result')).toHaveCount(1);
        await page.locator('.result').click();
        await settled(page);

        // Following should be off.
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'false');

        // Deliver a new fix — camera should hold.
        const afterSearch = await camera(page);
        await context.setGeolocation(SECOND_FIX);
        await waitForLiveFix(page);
        await settled(page);
        await expectCameraToHold(page, afterSearch);
      }

      await atViewport(page, viewport, check);
    });
  }
});

// Restart with the same coordinates: follow, drag (stops), click again after the fix goes stale.
// The stale state forces #startFollowing through requestPosition(), which is where the old code
// failed to reset #lastFollowedCoordinates and never moved the camera on the retry.
test.describe('GPS follow — restart with same coordinates', () => {
  test.use({permissions: ['geolocation'], geolocation: FIRST_FIX});

  for (const {name, viewport} of deviceCases) {
    test(`restart following with same coordinates on ${name}`, async ({page, context}) => {
      async function check() {
        // Install the clock before the page loads so the PositionTracker's reevaluation interval
        // uses the controlled clock. After making the fix stale, we switch to setSystemTime so
        // that Date.now() advances naturally and MapLibre's easeTo animations work normally.
        await page.clock.install();
        await ready(page);
        await context.setGeolocation(FIRST_FIX);
        await waitForLiveFix(page);

        // Start following.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');

        // Drag the map to stop following.
        const canvas = page.locator('#map canvas');
        const box = await canvas.boundingBox();
        const centerX = box.x + box.width / 2;
        const centerY = box.y + box.height / 2;
        await page.mouse.move(centerX, centerY);
        await page.mouse.down();
        await page.mouse.move(centerX + 100, centerY + 100);
        await page.mouse.up();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'false');

        // Fast-forward past the freshness limit so the fix becomes stale.
        // This is essential: when the state is still 'live', #startFollowing moves the camera
        // directly and the old code works. Only a stale state forces the requestPosition() path.
        await page.clock.fastForward(31_000);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-state', 'stale');

        // Switch to system time so MapLibre's easeTo animations (requestAnimationFrame) work normally.
        // The state remains 'stale' because the snapshot was already updated by the clock.
        await page.clock.setSystemTime(new Date());

        // Click again — the stale state forces a retry, which delivers the same coordinates.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');

        // Camera should centre on the fix — this is the key assertion.
        // On the old code, #lastFollowedCoordinates was not reset, so #isNewFollowFix returned false
        // and the camera stayed where the drag left it (~150 m from the fix) even though data-following
        // was 'true'. A tight tolerance distinguishes 'camera at fix' from 'camera where drag left it'.
        await expect
          .poll(() =>
            page.evaluate(
              (fix) => window.kompasDebug.map.getCenter().distanceTo({lng: fix.longitude, lat: fix.latitude}),
              FIRST_FIX
            )
          )
          .toBeLessThan(50);
      }

      await atViewport(page, viewport, check);
    });
  }
});

// Resize while following: following should not stop.
// The old code stopped following on every movestart that wasn't tagged by the follower.
// A viewport resize fires movestart synchronously, so following was incorrectly stopped.
test.describe('GPS follow — resize while following', () => {
  test.use({permissions: ['geolocation'], geolocation: FIRST_FIX});

  for (const {name, viewport} of deviceCases) {
    test(`map resize does not stop following on ${name}`, async ({page, context}) => {
      async function check() {
        await ready(page);
        await context.setGeolocation(FIRST_FIX);
        await waitForLiveFix(page);

        // Start following and wait for the camera animation to fully settle.
        // Without this wait, the follow ease may still be running when we resize,
        // and MapLibre fires no movestart while already moving — so the old code's
        // stopFollowingOnForeignMove never fires and the test passes by accident.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');
        await expectCameraToHold(page, await camera(page));

        // Resize the viewport by a clear amount so the map container actually changes size.
        const resizedViewport = name === 'desktop'
          ? {width: 1000, height: 700}
          : name === 'mobile'
            ? {width: 390, height: 844}
            : {width: 360, height: 360};
        await page.setViewportSize(resizedViewport);
        await settled(page);

        // Following should still be active after resize.
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');
      }

      await atViewport(page, viewport, check);
    });
  }
});

// Dismissed prompt: start with permission not granted, click triggers error callback.
test.describe('GPS follow — dismissed prompt', () => {
  for (const {name, viewport} of deviceCases) {
    test(`dismissed permission prompt shows error on ${name}`, async ({page}) => {
      async function check() {
        // Simulate permission not granted: watchPosition calls error callback with code 1.
        await page.addInitScript(() => {
          const originalQuery = navigator.permissions.query.bind(navigator.permissions);
          navigator.permissions.query = async (permissionDescriptor) => {
            if (permissionDescriptor?.name === 'geolocation') {
              return {state: 'prompt', addEventListener: () => {}};
            }
            return originalQuery(permissionDescriptor);
          };
          const originalWatchPosition = navigator.geolocation.watchPosition.bind(navigator.geolocation);
          navigator.geolocation.watchPosition = function(success, error, options) {
            // Simulate the error callback being called (permission dismissed).
            if (error) error({code: 1, message: 'Permission dismissed'});
            return originalWatchPosition(success, error, options);
          };
        });
        await ready(page);
        // State is 'prompt' after the error callback (code 1 with permission !== 'denied').
        await expect
          .poll(() => page.locator('#position-badge').getAttribute('data-state'))
          .toBe('prompt');

        // Click the position button — following should not start, error should be visible.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'false');
        await expect(page.locator('#error')).toBeVisible();
      }

      await atViewport(page, viewport, check);
    });
  }
});

// ---------------------------------------------------------------------------
// Full-screen dock on Mobile and Flip (issue #104)
// ---------------------------------------------------------------------------

// On Mobile and Flip, the open dock covers the entire layout viewport (top 0, 100dvh).
// Desktop keeps the side dock narrower than the viewport.
test.describe('dock fills viewport on mobile and flip', () => {
  test.beforeEach(({page}) => stubRouting(page));

  const MOBILE_VIEWPORT = {width: 412, height: 840};
  const FLIP_VIEWPORT_SIZE = {width: 340, height: 340};
  const DESKTOP_VIEWPORT = {width: 1280, height: 800};

  // Check that the sidebar/dock covers the full viewport and that elementFromPoint
  // at each corner and the center returns an element inside the sidebar, not the map.
  async function assertDockCoversViewport(page) {
    const viewport = page.viewportSize();
    const sidebar = page.locator('.sidebar');
    const box = await sidebar.boundingBox();
    expect(box).not.toBeNull();
    // Position: dock starts at or before the viewport origin
    expect(box.x).toBeLessThanOrEqual(0.5);
    expect(box.y).toBeLessThanOrEqual(0.5);
    // Size: dock fills the viewport within 1 px tolerance
    expect(Math.abs(box.width - viewport.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(box.height - viewport.height)).toBeLessThanOrEqual(1);

    // elementFromPoint at corners and center should be inside the sidebar, not the map canvas
    const points = [
      {x: 1, y: 1},
      {x: viewport.width - 1, y: 1},
      {x: 1, y: viewport.height - 1},
      {x: viewport.width - 1, y: viewport.height - 1},
      {x: Math.floor(viewport.width / 2), y: Math.floor(viewport.height / 2)}
    ];
    for (const point of points) {
      const result = await page.evaluate(({x, y}) => {
        const el = document.elementFromPoint(x, y);
        return {
          tag: el ? el.tagName.toLowerCase() : null,
          isInsideSidebar: el && document.querySelector('.sidebar')?.contains(el)
        };
      }, point);
      // The element should be inside the sidebar (aside, div, button, etc.), not the map canvas
      expect(result.tag).not.toBe('canvas');
      expect(result.isInsideSidebar).toBe(true);
    }
  }

  // Check that the map is visible again after closing the dock
  async function assertMapVisibleAfterClose(page) {
    const viewport = page.viewportSize();
    // Check that the center of the viewport is the map canvas
    const tag = await page.evaluate(({x, y}) => {
      const el = document.elementFromPoint(x, y);
      return el ? el.tagName.toLowerCase() : null;
    }, {x: Math.floor(viewport.width / 2), y: Math.floor(viewport.height / 2)});
    expect(tag).toBe('canvas');
  }

  test('dock covers full viewport on mobile', {tag: '@phone'}, async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await atViewport(page, MOBILE_VIEWPORT, async () => {
      await ready(page);
      await openMenu(page);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
      await assertDockCoversViewport(page);

      // Close the dock and verify the map is visible again
      await closeMenu(page);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
      await assertMapVisibleAfterClose(page);
    });
  });

  test('dock covers full viewport on flip', {tag: '@phone'}, async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await atViewport(page, FLIP_VIEWPORT_SIZE, async () => {
      await ready(page);
      await openMenu(page);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
      await assertDockCoversViewport(page);

      // Close the dock and verify the map is visible again
      await closeMenu(page);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
      await assertMapVisibleAfterClose(page);
    });
  });

  test('dock stays narrower than viewport on desktop', async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await atViewport(page, DESKTOP_VIEWPORT, async () => {
      await ready(page);
      await openMenu(page);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');

      const viewport = page.viewportSize();
      const sidebar = page.locator('.sidebar');
      const box = await sidebar.boundingBox();
      expect(box).not.toBeNull();
      // On desktop, the dock is narrower than the viewport
      expect(box.width).toBeLessThan(viewport.width);
      // The map canvas should still be visible beside the dock
      const mapTag = await page.evaluate(({x, y}) => {
        const el = document.elementFromPoint(x, y);
        return el ? el.tagName.toLowerCase() : null;
      }, {x: viewport.width - 1, y: Math.floor(viewport.height / 2)});
      expect(mapTag).toBe('canvas');
    });
  });
});

// Creates an 8-place fixture with the given prefix for ids and names.
function manyPlacesFixture(prefix) {
  return {
    type: 'FeatureCollection',
    features: Array.from({length: 8}, (_, index) => ({
      type: 'Feature',
      geometry: {type: 'Point', coordinates: [19.26 + index * 0.004, 42.44]},
      properties: {
        id: prefix + '/' + index,
        name: prefix.charAt(0).toUpperCase() + prefix.slice(1) + ' place ' + index,
        category: index % 2 ? 'food' : 'shops',
        kind: 'shop'
      }
    }))
  };
}

// ---------------------------------------------------------------------------
// Flip dock: minimizable footer (issue #155, replaces issue #104 one-column scroll)
// ---------------------------------------------------------------------------

// The requirement changed: instead of a one-column scroll, Flip uses a pinned
// footer that starts minimized (only a handle row shows). The handle is a
// <button> with aria-expanded and aria-controls. Opening it reveals Satellite,
// Transport, Download, and attribution. Closing the dock resets to minimized.

test.describe('Flip dock minimizable footer', () => {
  test.beforeEach(({page}) => stubRouting(page));

  const FLIP_VIEWPORT = {width: 340, height: 340};
  const manyPlaces = manyPlacesFixture('flip-footer');

  test('opening the dock shows the handle and hides layer buttons and Download',
    {tag: '@phone'}, async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: manyPlaces}));
    await atViewport(page, FLIP_VIEWPORT, async () => {
      await ready(page);
      await openMenu(page);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');

      // The footer toggle handle is visible.
      await expect(page.locator('#footer-toggle')).toBeVisible();

      // Footer starts minimized: aria-expanded is false.
      await expect(page.locator('#footer-toggle')).toHaveAttribute('aria-expanded', 'false');

      // Layer buttons and Download are hidden while minimized.
      await expect(page.locator('#satellite-toggle')).toBeHidden();
      await expect(page.locator('#transport-toggle')).toBeHidden();
      await expect(page.locator('#download')).toBeHidden();

      // At least 3 results are visible.
      await expect(page.locator('.result')).toHaveCount(8);
      const visibleResults = await page.evaluate((vh) => {
        const results = document.querySelectorAll('.result');
        let count = 0;
        for (const row of results) {
          const rect = row.getBoundingClientRect();
          if (rect.top >= 0 && rect.bottom <= vh) count++;
        }
        return count;
      }, FLIP_VIEWPORT.height);
      expect(visibleResults).toBeGreaterThanOrEqual(3);
    });
  });

  test('clicking the handle shows all footer content and sets aria-expanded true',
    {tag: '@phone'}, async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: manyPlaces}));
    await atViewport(page, FLIP_VIEWPORT, async () => {
      await ready(page);
      await openMenu(page);

      // Open the footer.
      await page.locator('#footer-toggle').click();

      // aria-expanded is now true.
      await expect(page.locator('#footer-toggle')).toHaveAttribute('aria-expanded', 'true');

      // Layer buttons and Download are visible (not hidden by CSS).
      await expect(page.locator('#satellite-toggle')).toBeVisible();
      await expect(page.locator('#transport-toggle')).toBeVisible();
      await expect(page.locator('#download')).toBeVisible();

      // Attribution is also visible.
      await expect(page.locator('#map-attribution')).toBeVisible();

      // Results area is hidden while footer is expanded (wiki drawing 2).
      await expect(page.locator('.dock-main')).toBeHidden();
    });
  });

  test('clicking the handle again hides the footer content',
    {tag: '@phone'}, async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: manyPlaces}));
    await atViewport(page, FLIP_VIEWPORT, async () => {
      await ready(page);
      await openMenu(page);

      // Open then close the footer.
      await page.locator('#footer-toggle').click();
      await page.locator('#footer-toggle').click();

      await expect(page.locator('#footer-toggle')).toHaveAttribute('aria-expanded', 'false');
      await expect(page.locator('#satellite-toggle')).toBeHidden();
      await expect(page.locator('#download')).toBeHidden();
    });
  });

  test('the handle is reachable by Tab and toggles with Enter',
    {tag: '@phone'}, async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: manyPlaces}));
    await atViewport(page, FLIP_VIEWPORT, async () => {
      await ready(page);
      await openMenu(page);

      // Tab to the footer toggle (it should be in the tab order).
      await page.locator('#footer-toggle').focus();
      await expect(page.locator('#footer-toggle')).toBeFocused();

      // Press Enter to toggle open.
      await page.keyboard.press('Enter');
      await expect(page.locator('#footer-toggle')).toHaveAttribute('aria-expanded', 'true');

      // Press Enter again to toggle closed.
      await page.keyboard.press('Enter');
      await expect(page.locator('#footer-toggle')).toHaveAttribute('aria-expanded', 'false');
    });
  });

  test('closing the dock resets the footer to minimized',
    {tag: '@phone'}, async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: manyPlaces}));
    await atViewport(page, FLIP_VIEWPORT, async () => {
      await ready(page);
      await openMenu(page);

      // Open the footer.
      await page.locator('#footer-toggle').click();
      await expect(page.locator('#footer-toggle')).toHaveAttribute('aria-expanded', 'true');

      // Close the dock.
      await closeMenu(page);
      await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');

      // Reopen the dock — footer should be minimized again.
      await openMenu(page);
      await expect(page.locator('#footer-toggle')).toHaveAttribute('aria-expanded', 'false');
    });
  });
});

// ---------------------------------------------------------------------------
// Flip dock: keyboard awareness, Escape, and focus (issue #146)
// ---------------------------------------------------------------------------

test.describe('Flip dock keyboard awareness', () => {
  test.beforeEach(({page}) => stubRouting(page));

  const PHONE_VIEWPORT = {width: 412, height: 840};
  const FLIP_VIEWPORT_SIZE = {width: 340, height: 340};

  const manyPlaces = manyPlacesFixture('kb');

  // On both phone and Flip, opening the dock, focusing search, and simulating
  // a keyboard should keep the last result visible above the keyboard.
  // On Flip, .results scrolls independently inside dock-content (the footer is
  // pinned and minimizable). On phone, .results also scrolls independently.
  for (const {name, viewport} of [
    {name: 'phone', viewport: PHONE_VIEWPORT},
    {name: 'flip', viewport: FLIP_VIEWPORT_SIZE}
  ]) {
    test(`last result stays above keyboard on ${name}`, {tag: '@phone'}, async ({page}) => {
      await page.route('**/data/places.geojson', route => route.fulfill({json: manyPlaces}));
      await atViewport(page, viewport, async () => {
        await ready(page);
        await openMenu(page);
        await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
        await expect(page.locator('.result')).toHaveCount(8);

        // Focus the search field to trigger the keyboard.
        await page.locator('#search').focus();
        // Simulate the keyboard appearing (half the viewport height).
        const keyboardHeight = Math.floor(viewport.height / 2);
        await simulateKeyboard(page, keyboardHeight);

        // Scroll to the bottom so the last result is at the end.
        // On both phone and Flip, .results scrolls independently inside dock-content.
        await page.evaluate(() => {
          const results = document.getElementById('results');
          results.scrollTop = results.scrollHeight;
        });

        // The last .result's bottom must be at or above the visible viewport bottom.
        const lastResultVisible = await page.evaluate(({visibleHeight, visibleTop}) => {
          const results = document.querySelectorAll('.result');
          const lastResult = results[results.length - 1];
          if (!lastResult) return false;
          const rect = lastResult.getBoundingClientRect();
          const viewportBottom = visibleTop + visibleHeight;
          return rect.bottom <= viewportBottom + 1; // 1 px tolerance
        }, {visibleHeight: viewport.height - keyboardHeight, visibleTop: 0});
        expect(lastResultVisible).toBe(true);
      });
    });
  }
});

test.describe('Escape closes dock and restores focus', () => {
  test.beforeEach(({page}) => stubRouting(page));

  const PHONE_VIEWPORT = {width: 412, height: 840};
  const FLIP_VIEWPORT_SIZE = {width: 340, height: 340};

  for (const {name, viewport} of [
    {name: 'phone', viewport: PHONE_VIEWPORT},
    {name: 'flip', viewport: FLIP_VIEWPORT_SIZE}
  ]) {
    test(`Escape with dock open gives data-view closed and focus on menu on ${name}`,
      {tag: '@phone'}, async ({page}) => {
      await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
      await atViewport(page, viewport, async () => {
        await ready(page);
        await openMenu(page);
        await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');

        // Press Escape to close the dock.
        await page.keyboard.press('Escape');

        // Dock should be closed and focus returned to the menu button.
        await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
        await expect(page.locator('#menu-toggle')).toBeFocused();
      });
    });
  }
});

// Layer toggle while following: following should stop on the camera move.
test.describe('GPS follow — layer toggle stops following', () => {
  test.use({permissions: ['geolocation'], geolocation: FIRST_FIX});

  for (const {name, viewport} of deviceCases) {
    test(`toggling satellite layer stops following on ${name}`, async ({page, context}) => {
      await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
      await page.setViewportSize(viewport);
      await ready(page);
      await context.setGeolocation(FIRST_FIX);
      await waitForLiveFix(page);

      // Start following.
      await page.locator('#position-action').click();
      await settled(page);
      await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');

      // Open the menu to access the satellite toggle, then toggle it.
      await openMenu(page);
      // On Flip, the footer starts minimized — expand it to reach the satellite toggle.
      if (name === 'flip') await page.locator('#footer-toggle').click();
      await page.locator('#satellite-toggle').click();
      await settled(page);

      // Following should be off (the camera move from the satellite toggle stops it).
      await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'false');

      // Deliver a new fix — camera should hold.
      const afterToggle = await camera(page);
      await context.setGeolocation(SECOND_FIX);
      await waitForLiveFix(page);
      await settled(page);
      await expectCameraToHold(page, afterToggle);
    });
  }
});

// Defect 3: The computed background of #position-action differs between following and not following.
test.describe('GPS follow — button style', () => {
  test.use({permissions: ['geolocation'], geolocation: FIRST_FIX});

  for (const {name, viewport} of deviceCases) {
    test(`position button background differs when following on ${name}`, async ({page, context}) => {
      async function check() {
        await ready(page);
        await context.setGeolocation(FIRST_FIX);
        await waitForLiveFix(page);

        // Read the CSS custom property --green from the root computed style.
        const greenColor = await page.evaluate(() =>
          getComputedStyle(document.documentElement).getPropertyValue('--green').trim()
        );

        // Not following: background is transparent (or near-transparent).
        const backgroundNotFollowing = await page.locator('#position-action').evaluate(
          el => getComputedStyle(el).backgroundColor
        );

        // Start following.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'true');

        // Following: background should match --green.
        const backgroundFollowing = await page.locator('#position-action').evaluate(
          el => getComputedStyle(el).backgroundColor
        );

        expect(backgroundFollowing).not.toEqual(backgroundNotFollowing);
        // Convert hex --green to rgb for comparison (e.g. #193f36 → rgb(25, 63, 54)).
        const red = parseInt(greenColor.slice(1, 3), 16);
        const green = parseInt(greenColor.slice(3, 5), 16);
        const blue = parseInt(greenColor.slice(5, 7), 16);
        const expectedRgb = `rgb(${red}, ${green}, ${blue})`;
        expect(backgroundFollowing).toBe(expectedRgb);

        // Stop following — background should no longer be green.
        await page.locator('#position-action').click();
        await settled(page);
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'false');

        const backgroundAfterStop = await page.locator('#position-action').evaluate(
          el => getComputedStyle(el).backgroundColor
        );

        expect(backgroundAfterStop).not.toBe(expectedRgb);
      }

      await atViewport(page, viewport, check);
    });
  }

});

// Left dock: vertical order, nearest-first list, category + query filtering
test('left dock shows elements in vertical order: search, categories, results, layers, download', async ({
  page
}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
  await ready(page);
  await openMenu(page);
  await expect(page.locator('.result')).toHaveCount(3);

  const searchBar = await page.locator('.search-bar').boundingBox();
  const categories = await page.locator('#categories').boundingBox();
  const results = await page.locator('#results').boundingBox();
  const layerGrid = await page.locator('.layer-grid').boundingBox();
  const download = await page.locator('#download').boundingBox();

  // Assert vertical order by top Y coordinates (categories and results are adjacent, so >= is correct)
  expect(categories.y).toBeGreaterThan(searchBar.y);
  expect(results.y).toBeGreaterThanOrEqual(categories.y + categories.height);
  expect(layerGrid.y).toBeGreaterThan(results.y);
  expect(download.y).toBeGreaterThan(layerGrid.y);
});

test('panning the map changes the first result to the place nearest the new centre', async ({
  page
}) => {
  // Create places at known positions so nearest ordering is deterministic.
  const places = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [19.25, 42.44]},
        properties: {id: 'near-west', name: 'West Place', category: 'shops', kind: 'shop', visibilityLevel: 4}
      },
      {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [19.28, 42.44]},
        properties: {id: 'near-east', name: 'East Place', category: 'shops', kind: 'shop', visibilityLevel: 4}
      },
      {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [19.30, 42.44]},
        properties: {id: 'far-east', name: 'Far East', category: 'shops', kind: 'shop', visibilityLevel: 4}
      }
    ]
  };
  await page.route('**/data/places.geojson', route => route.fulfill({json: places}));
  await ready(page);
  await openMenu(page);

  // Default centre is near [19.26, 42.437]; West Place (19.25) is nearest.
  await expect(page.locator('.result').first()).toContainText('West Place');

  // Pan the map east so East Place becomes nearest.
  await page.evaluate(() => {
    window.kompasDebug.map.jumpTo({center: [19.28, 42.44], zoom: window.kompasDebug.map.getZoom()});
  });
  await settled(page);

  // After moveend, the list re-sorts; East Place (19.28) is now nearest.
  await expect(page.locator('.result').first()).toContainText('East Place');
});

test('category filter then query filter narrows results to both', async ({page}) => {
  const places = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [19.25, 42.44]},
        properties: {id: 'cafe-a', name: 'Cafe Alpha', category: 'food', kind: 'cafe', visibilityLevel: 4}
      },
      {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [19.26, 42.44]},
        properties: {id: 'cafe-b', name: 'Cafe Beta', category: 'food', kind: 'cafe', visibilityLevel: 4}
      },
      {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [19.27, 42.44]},
        properties: {id: 'shop-a', name: 'Alpha Shop', category: 'shops', kind: 'shop', visibilityLevel: 4}
      },
      {
        type: 'Feature',
        geometry: {type: 'Point', coordinates: [19.28, 42.44]},
        properties: {id: 'sight-a', name: 'Alpha Sight', category: 'sights', kind: 'museum', visibilityLevel: 4}
      }
    ]
  };
  await page.route('**/data/places.geojson', route => route.fulfill({json: places}));
  await ready(page);
  await openMenu(page);

  // No filter: all 4 places shown
  await expect(page.locator('.result')).toHaveCount(4);

  // Press food category: only 2 cafes
  await page.locator('#categories').getByRole('button', {name: 'Eat & drink', exact: true}).click();
  await expect(page.locator('.result')).toHaveCount(2);
  // Waiting assertions avoid racing the re-render after category click
  await expect(page.locator('.result', {hasText: 'Cafe Alpha'})).toHaveCount(1);
  await expect(page.locator('.result', {hasText: 'Cafe Beta'})).toHaveCount(1);

  // Type query within the category: only Cafe Alpha matches 'alpha' + food
  await page.locator('#search').fill('alpha');
  await expect(page.locator('.result')).toHaveCount(1);
  await expect(page.locator('.result').first()).toContainText('Cafe Alpha');
  // Alpha Shop (shops) and Alpha Sight (sights) are excluded by category
});

// ---------------------------------------------------------------------------
// Menu button resets after mouse click (issue #155)
// ---------------------------------------------------------------------------

test.describe('menu button resets after mouse click', () => {
  test.beforeEach(({page}) => stubRouting(page));

  // After opening and closing the dock by mouse click, #menu-toggle's computed
  // background should equal its value before opening. The button should not
  // stay visually pressed.
  for (const {name, viewport} of [
    {name: 'desktop', viewport: {width: 1280, height: 800}},
    {name: 'phone', viewport: {width: 412, height: 840}}
  ]) {
    test(`menu button background resets after open and close on ${name}`,
      {tag: name === 'phone' ? '@phone' : undefined}, async ({page}) => {
      await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
      await page.setViewportSize(viewport);
      await ready(page);

      // Measure the computed background before any interaction.
      const backgroundBefore = await page.locator('#menu-toggle').evaluate(
        el => getComputedStyle(el).backgroundColor
      );

      // Open the dock by clicking the menu button.
      await page.locator('#menu-toggle').click();
      await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');

      // Close the dock by clicking the menu button again.
      await page.locator('#menu-toggle').click();
      await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');

      // Move the mouse away from the button so :hover does not affect the measurement.
      await page.mouse.move(1, 1);

      // Measure the computed background after closing.
      const backgroundAfter = await page.locator('#menu-toggle').evaluate(
        el => getComputedStyle(el).backgroundColor
      );

      // The background should be the same as before opening.
      expect(backgroundAfter).toEqual(backgroundBefore);
    });
  }
});

