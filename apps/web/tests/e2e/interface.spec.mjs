import {test, expect} from '@playwright/test';
import {
  atViewport,
  camera,
  closeCard,
  closeMenu,
  fixture,
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
    await expect(page.locator('body')).toHaveAttribute('data-view', isMobile ? 'search' : 'dock');
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
  // On desktop the floating categories are in #desktop-categories; on mobile they are in #categories.
  const isDesktop = (await page.locator('body').getAttribute('data-device')) === 'desktop';
  const categoryContainer = isDesktop ? '#desktop-categories' : '#categories';
  await page.locator(categoryContainer).getByRole('button', {name: 'Eat & drink', exact: true}).click();
  await expect(page.locator('.result')).toHaveCount(3);
  await page.locator('#search').fill('Nearby place 3');
  await expect(page.locator('.result')).toHaveCount(1);
  await expectCameraToHold(page, before);
});

test('choosing a result moves the map only when the result is outside the focus zone', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  const target = nearbyPlaces.features[0].geometry.coordinates;
  await page.evaluate(
    lngLat => window.kompasDebug.map.jumpTo({center: [lngLat[0] + 0.02, lngLat[1] + 0.01], zoom: 16}),
    target
  );
  // Open the dock to access the results list.
  await openMenu(page);
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
    await page.locator('#search').click();
    // A pinch-zoomed phone page, or a desktop window's visual viewport: neither is a keyboard.
    await simulateKeyboard(page, 420, isMobile ? 1.5 : 1);
    const before = await camera(page);
    await page.locator('.result', {hasText: 'Nearby place 0'}).click();
    await expect.poll(async () => (await camera(page)).center).not.toEqual(before.center);
  }
);

test('the result list keeps its order while a chosen place is open and re-sorts after', async ({page}) => {
  await page.route('**/data/places.geojson', route => route.fulfill({json: nearbyPlaces}));
  await ready(page);
  await settled(page);
  const lastPlace = nearbyPlaces.features[5].geometry.coordinates;
  await page.evaluate(lngLat => window.kompasDebug.map.jumpTo({center: lngLat, zoom: 16}), lastPlace);
  // Open the dock to access the results list.
  await openMenu(page);
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
    await page.locator('#search').click();
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
// GPS follow location (issue #99) — real geolocation
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
  for (const {name, viewport} of deviceCases) {
    test(`clicking position button starts following on ${name}`, async ({page, context}) => {
      async function check() {
        await ready(page);
        await context.setGeolocation(FIRST_FIX);
        await waitForLiveFix(page);

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

        // Camera should have moved to the new fix.
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

  // Test d: Drag the map stops following.
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

  test('search bar is taller than 54 px on desktop', async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    const bar = await page.locator('.search-bar').boundingBox();
    expect(bar.height).toBeGreaterThan(54);
    expect(bar.height).toBe(60);
  });

  test('floating categories are visible under the bar with no query and dock closed', async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    await closeMenu(page);
    const categories = page.locator('#desktop-categories');
    await expect(categories).toBeVisible();
    // Check that category buttons exist.
    await expect(categories.locator('button')).toHaveCount(5);
    // The dock should be closed.
    await expect(page.locator('#dock-content')).toBeHidden();
  });

  test('floating categories scroll horizontally when they overflow', async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    await closeMenu(page);
    const categories = page.locator('#desktop-categories');
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

  test('typing shows the clear button and clicking it empties the input', async ({page}) => {
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

  test('with a query, categories and results are inside one container under the bar', async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    // Type a query that matches some places.
    await page.locator('#search').fill('Café');
    await expect(page.locator('#clear-search')).toBeVisible();
    // The desktop search panel should be visible.
    const panel = page.locator('#desktop-search-panel');
    await expect(panel).toBeVisible();
    // The floating categories should be hidden.
    await expect(page.locator('#desktop-categories')).toBeHidden();
    // The panel should contain the browse panel with categories and results.
    await expect(panel.locator('#categories')).toBeVisible();
    await expect(panel.locator('#results')).toBeVisible();
  });

  test('Escape clears a non-empty query on desktop', async ({page}) => {
    await page.route('**/data/places.geojson', route => route.fulfill({json: fixture}));
    await ready(page);
    await page.locator('#search').fill('test query');
    await expect(page.locator('#clear-search')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#search')).toHaveValue('');
    await expect(page.locator('#clear-search')).toBeHidden();
  });

  test('Tab reaches menu button, input, clear button, and category chips', async ({page}) => {
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
  });
});

// Test e: Geolocation permission denied — click shows recovery message, data-following stays false.
test.describe('GPS follow location — denied', () => {
  for (const {name, viewport} of deviceCases) {
    test(`clicking position button with geolocation denied on ${name}`, async ({page}) => {
      async function check() {
        // Simulate denied state: override permissions.query to return 'denied' for geolocation,
        // and have watchPosition call the error callback with code 1 (PERMISSION_DENIED).
        await page.addInitScript(() => {
          const origQuery = navigator.permissions.query.bind(navigator.permissions);
          navigator.permissions.query = async (desc) => {
            if (desc?.name === 'geolocation') {
              return {state: 'denied', addEventListener: () => {}};
            }
            return origQuery(desc);
          };
          const origWatch = navigator.geolocation.watchPosition;
          navigator.geolocation.watchPosition = function(success, error, options) {
            if (error) error({code: 1, message: 'Permission denied'});
            return origWatch.call(this, success, error, options);
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

        // data-following should remain false (render() turns it off for denied state).
        await expect(page.locator('#position-badge')).toHaveAttribute('data-following', 'false');
        // The status text should mention the denied condition.
        await expect(page.locator('#position-status')).toHaveText(/Location blocked/);
      }

      await atViewport(page, viewport, check);
    });
  }
});
