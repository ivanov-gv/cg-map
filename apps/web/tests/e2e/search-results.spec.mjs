import {test, expect} from '@playwright/test';
import {roadLayerIds} from '../pinned-core.mjs';
import {matchesStreetName, normalizeSearchText} from '../../src/shared/core.js';
import {
  CAMERA_HOLD_MILLISECONDS,
  camera,
  closeCard,
  closeMenu,
  expectCameraToHold,
  expectToHold,
  mapIdle,
  pointOnMap,
  ready,
  settled,
  stubRouting,
  tapMapCenter,
  withFlipViewport
} from './helpers.mjs';

const CENTRE = [19.2607, 42.4419];
const JEREVANSKA_CENTRE = [19.250864, 42.422188];
const JEREVANSKA_LABEL = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: JEREVANSKA_CENTRE},
  properties: {
    kind: 'building',
    footprintIndex: 7,
    'addr:housenumber': '4',
    'addr:street': 'Jerevanska'
  }
};
const ADDRESS = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: CENTRE},
  properties: {
    kind: 'building',
    footprintIndex: 4,
    'addr:housenumber': '18',
    'addr:street': 'Bulevar Stanka Dragojevića'
  }
};
// The uncovered focus zone differs by viewport, so each project places its unique building at that zone's centre.
const FOCUS_COORDINATES = {
  'root-desktop': [19.261622679898437, 42.44233545953725],
  'pages-mobile': [19.26054979629413, 42.44126264012965]
};
const secondAddress = () => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates: FOCUS_COORDINATES[test.info().project.name]},
  properties: {
    kind: 'building',
    footprintIndex: 5,
    'addr:housenumber': '13',
    'addr:street': 'Njegoševa ulica'
  }
});
const PLACE = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.26065, 42.44195]},
  properties: {id: 'node/1', name: 'Bulevar Cafe', category: 'food', kind: 'cafe'}
};
const SECOND_PLACE = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.26085, 42.44205]},
  properties: {id: 'node/2', name: 'Bulevar Market', category: 'food', kind: 'market'}
};
const LOW_LEVEL_MATCH = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.26068, 42.44192]},
  properties: {
    id: 'node/3',
    name: 'Threshold Cafe',
    category: 'food',
    kind: 'cafe',
    visibilityLevel: 1
  }
};
const HIGH_LEVEL_MATCH = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.26095, 42.44208]},
  properties: {
    id: 'node/4',
    name: 'Threshold Market',
    category: 'food',
    kind: 'market',
    visibilityLevel: 5
  }
};
const NON_FOOD_PLACE = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.2605, 42.44215]},
  properties: {id: 'node/5', name: 'Museum', category: 'sights', kind: 'museum'}
};
const FOOD_PLACE_IDS = ['node/1', 'node/2', 'node/3', 'node/4'];
const QUERY_RESULT_IDS = ['node/1', 'node/2'];
const FAR_ADDRESS = {
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.8, 42.8]},
  properties: {
    kind: 'building',
    footprintIndex: 6,
    'addr:housenumber': '77',
    'addr:street': 'Planinska ulica'
  }
};
const MANY_ADDRESSES = Array.from({length: 45}, (_, index) => ({
  type: 'Feature',
  geometry: {type: 'Point', coordinates: [19.2607 + index * 0.00002, 42.4419]},
  properties: {
    kind: 'building',
    footprintIndex: 1000 + index,
    'addr:housenumber': '900',
    'addr:street': 'Testna ulica'
  }
}));

const highlightState = page =>
  page.evaluate(() => {
    const map = window.kompasDebug.map;
    return {
      buildings: map.queryRenderedFeatures({layers: ['search-building-outline']}).map(feature => feature.id),
      rings: map
        .queryRenderedFeatures({layers: ['search-place-rings']})
        .map(feature => feature.properties.markerKey),
      buildingFilter: map.getFilter('search-building-outline'),
      buildingColor: map.getPaintProperty('search-building-outline', 'line-color'),
      ringColor: map.getPaintProperty('search-place-rings', 'circle-stroke-color'),
      searchGreen: getComputedStyle(document.documentElement).getPropertyValue('--search-highlight').trim()
    };
  });
// Expands the ordinary and all-zoom marker layers to the identities used by the result list and ring comparison.
const renderedPlaceIds = page =>
  page.evaluate(() => {
    const map = window.kompasDebug.map;
    const layers = map
      .getStyle()
      .layers.map(layer => layer.id)
      .filter(id => id.startsWith('place-icons-') || id === 'search-place' || id === 'search-result-places');
    return [
      ...new Set(map.queryRenderedFeatures({layers}).flatMap(feature => JSON.parse(feature.properties.activeIds)))
    ].sort();
  });
const expectQueryHighlights = async page => {
  await expect.poll(() => renderedResultMarkerIds(page)).toEqual(QUERY_RESULT_IDS);
  await expect.poll(async () => (await highlightState(page)).buildings).toEqual([4]);
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(QUERY_RESULT_IDS);
  await expect.poll(() => renderedPlaceIds(page)).toEqual(FOOD_PLACE_IDS);
};
// The published core names the selectable road lines; a later release can add '-on-bridge' copies
// without changing this list. Park-route casing is only the wider underlay of the cream 'park-routes'
// line, so it adds no separate street name.
const ROAD_LAYERS = roadLayerIds([
  'steps',
  'cycleways',
  'paths',
  'footways',
  'park-routes',
  'pedestrian-streets',
  'minor-roads',
  'major-roads'
]);
// Street candidates come from rendered road lines and loaded address labels; the app's matcher decides which names
// become rows, so the expected set follows both the view and the query.
const streetNamesForQuery = async (page, query) => {
  const renderedRoadNames = await page.evaluate(
    ({layers}) => [
      ...new Set(
        window.kompasDebug.map
          .queryRenderedFeatures({layers})
          .filter(feature => ['LineString', 'MultiLineString'].includes(feature.geometry?.type))
          .map(feature => feature.properties.name)
          .filter(name => typeof name === 'string')
      )
    ],
    {layers: ROAD_LAYERS}
  );
  const labelStreetNames = [
    ADDRESS,
    secondAddress(),
    FAR_ADDRESS,
    JEREVANSKA_LABEL,
    ...MANY_ADDRESSES
  ].map(feature => feature.properties['addr:street']);
  return [...new Set([...renderedRoadNames, ...labelStreetNames])]
    .filter(name => matchesStreetName(name, query))
    .sort();
};
// Mirrors the row id rule in core.js so a matching street name still pins its exact Street row identity.
const streetRowIds = names =>
  names
    .map(name => `street/${normalizeSearchText(name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`)
    .sort();
// The explicit-filter marker layer is absent on older builds, so report an empty set instead of throwing there.
const renderedResultMarkerIds = page =>
  page.evaluate(() => {
    const map = window.kompasDebug.map;
    if (!map.getLayer('search-result-places')) return [];
    return [
      ...new Set(
        map
          .queryRenderedFeatures({layers: ['search-result-places']})
          .flatMap(feature => JSON.parse(feature.properties.activeIds))
      )
    ].sort();
  });
const isInView = (page, coordinates) =>
  page.evaluate(point => window.kompasDebug.map.getBounds().contains(point), coordinates);
const detailsLines = page => page.locator('#place-details p.detail').allInnerTexts();
// Existing place/building ordering assertions stay meaningful when a street row joins the same result set.
const nonStreetRowIds = page =>
  page.locator('.result:not([data-kind="street"])').evaluateAll(rows => rows.map(row => row.dataset.id));
const streetHighlight = page =>
  page.evaluate(() => {
    const map = window.kompasDebug.map;
    return {
      filter: map.getFilter('search-street-outline'),
      color: map.getPaintProperty('search-street-outline', 'line-color'),
      names: [
        ...new Set(
          map
            .queryRenderedFeatures({layers: ['search-street-outline']})
            .map(feature => feature.properties.name)
        )
      ]
    };
  });
const selectedRoad = page =>
  page.evaluate(() => {
    const map = window.kompasDebug.map;
    return {
      filter: map.getFilter('selected-roads-outline'),
      color: map.getPaintProperty('selected-roads-outline', 'line-color'),
      names: [
        ...new Set(
          map
            .queryRenderedFeatures({layers: ['selected-roads-outline']})
            .map(feature => feature.properties.name)
        )
      ]
    };
  });
// A rendered segment gives the same kind, name and details as a tap on the street itself.
const renderedRoadPoint = page =>
  page.evaluate(
    ({name, layers}) => {
      const map = window.kompasDebug.map;
      const bounds = map.getCanvas().getBoundingClientRect();
      for (const feature of map.queryRenderedFeatures({layers})) {
        if (feature.properties.name !== name) continue;
        if (!['LineString', 'MultiLineString'].includes(feature.geometry.type)) continue;
        const lines =
          feature.geometry.type === 'LineString'
            ? [feature.geometry.coordinates]
            : feature.geometry.coordinates;
        for (const coordinates of lines.flat()) {
          const point = map.project(coordinates);
          const canvas = map.getCanvas();
          const isOnCanvas =
            point.x >= 0 && point.y >= 0 && point.x <= canvas.clientWidth && point.y <= canvas.clientHeight;
          if (!isOnCanvas) continue;
          const screenPoint = {x: bounds.left + point.x, y: bounds.top + point.y};
          if (document.elementFromPoint(screenPoint.x, screenPoint.y) !== map.getCanvas()) continue;
          const hits = map.queryRenderedFeatures([point.x, point.y], {
            layers: ['buildings', ...layers]
          });
          const hasRoad = hits.some(hit => layers.includes(hit.layer.id) && hit.properties.name === name);
          const hasBuilding = hits.some(hit => hit.layer.id === 'buildings');
          if (hasRoad && !hasBuilding) return screenPoint;
        }
      }
      return null;
    },
    {name: 'Jerevanska', layers: ROAD_LAYERS}
  );

test.use({serviceWorkers: 'block'});

test.beforeEach(async ({page}) => {
  const address = secondAddress();
  await page.addInitScript(() => {
    localStorage.clear();
    // Keep startup's update handle without installing a shell that can re-navigate mid-test.
    Object.defineProperty(navigator.serviceWorker, 'register', {
      configurable: true,
      value: async () => ({update: async () => {}})
    });
  });
  await stubRouting(page);
  await page.route('**/data/building-labels.geojson', route =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [ADDRESS, address, FAR_ADDRESS, JEREVANSKA_LABEL, ...MANY_ADDRESSES]
      }
    })
  );
  await page.route('**/data/places.geojson', route =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [PLACE, SECOND_PLACE, LOW_LEVEL_MATCH, HIGH_LEVEL_MATCH]
      }
    })
  );
  await ready(page);
  await page.evaluate(coordinates => window.kompasDebug.map.jumpTo({center: coordinates, zoom: 17}), CENTRE);
});

test('result rows identify places, buildings and addresses and list the nearest first', {tag: '@phone'}, async ({page}) => {
  await mapIdle(page);
  const expectedStreetNames = await streetNamesForQuery(page, 'bulevar');
  expect(expectedStreetNames).toContain('Bulevar Stanka Dragojevića');
  await page.locator('#search').fill('bulevar');
  await expect(page.locator('.result')).toHaveCount(3 + expectedStreetNames.length);
  await expect(page.locator('.result[data-id="footprint/4"]')).toHaveAttribute('data-kind', 'address');
  await expect(page.locator('.result[data-id="footprint/4"] .symbol')).toHaveText('📍');
  await expect(page.locator('.result[data-id="node/1"]')).toHaveAttribute('data-kind', 'place');
  await expect(page.locator('.result[data-id="node/1"] .symbol')).toHaveText('C');
  await expect(page.locator('.result[data-id="node/2"]')).toHaveAttribute('data-kind', 'place');
  await expect(page.locator('.result[data-id="node/2"] .symbol')).toHaveText('M');
  expect((await page.locator('.result[data-kind="street"] strong').allInnerTexts()).sort()).toEqual(
    expectedStreetNames
  );
  expect(
    await page.locator('.result[data-kind="street"]').evaluateAll(rows => rows.map(row => row.dataset.id).sort())
  ).toEqual(streetRowIds(expectedStreetNames));
  expect(await nonStreetRowIds(page)).toEqual(['footprint/4', 'node/1', 'node/2']);

  await page.locator('#search').fill('13');
  await expect(page.locator('.result')).toHaveCount(1);
  await expect(page.locator('.result')).toHaveAttribute('data-kind', 'building');
  await expect(page.locator('.result').locator('.symbol')).toHaveText('🏢');
  await expect(page.locator('.result').locator('small')).toHaveText('Building');
});

test('one street row highlights its road green and opens the red Road card', async ({page}) => {
  await page.evaluate(center => window.kompasDebug.map.jumpTo({center, zoom: 17}), JEREVANSKA_CENTRE);
  await mapIdle(page);
  await closeMenu(page);
  const roadPoint = await renderedRoadPoint(page);
  expect(roadPoint).not.toBeNull();
  // The map ignores taps for 500 ms after a camera move; wait out that tap-drag window before the reference tap.
  await page.waitForTimeout(550);
  await page.mouse.click(roadPoint.x, roadPoint.y);
  await expect(page.locator('#place-name')).toHaveText('Jerevanska');
  await expect(page.locator('#place-category')).toHaveText('Road');
  // The last line is the tap's pixel-derived coordinate; the row uses the road segment's recorded coordinate.
  const tappedDetails = (await detailsLines(page)).slice(0, -1);
  await closeCard(page);

  await page.locator('#search').fill('jerevanska');
  const row = page.locator('.result[data-kind="street"]');
  await expect(row).toHaveCount(1);
  await expect(row).toHaveAttribute('data-id', 'street/jerevanska');
  await expect(row.locator('strong')).toHaveText('Jerevanska');
  await expect(row.locator('small')).toHaveText('Street');
  expect(await row.locator('.symbol').textContent()).toContain('🛣');

  await expect
    .poll(async () => (await streetHighlight(page)).names)
    .toEqual(['Jerevanska']);
  const green = await streetHighlight(page);
  expect(green.filter).toEqual(['in', ['get', 'name'], ['literal', ['Jerevanska']]]);
  expect(green.color).toBe('#2e7d32');

  await row.click();
  await expect(page.locator('#place-name')).toHaveText('Jerevanska');
  await expect(page.locator('#place-category')).toHaveText('Road');
  expect((await detailsLines(page)).slice(0, -1)).toEqual(tappedDetails);
  await expect.poll(async () => (await selectedRoad(page)).filter).toEqual([
    '==',
    ['get', 'name'],
    'Jerevanska'
  ]);
  expect((await selectedRoad(page)).color).toBe('#c43f3f');
  await expect.poll(async () => (await selectedRoad(page)).names).toEqual(['Jerevanska']);
  await expect.poll(async () => (await streetHighlight(page)).names).toEqual([]);
});

test('choosing an off-screen street reveals it at street zoom', async ({page}) => {
  const before = await camera(page);
  await closeMenu(page);
  await page.locator('#search').fill('jerevanska');
  const row = page.locator('.result[data-id="street/jerevanska"]');
  await expect(row).toHaveCount(1);
  await expect.poll(() => isInView(page, JEREVANSKA_CENTRE)).toBe(false);
  await row.click();
  await expect.poll(() => isInView(page, JEREVANSKA_CENTRE)).toBe(true);
  await settled(page);
  const after = await camera(page);
  expect(after.center).not.toEqual(before.center);
  expect(after.zoom).toBeGreaterThanOrEqual(15);
});

test('Mobile Back keeps unmatching places and result highlights with the query', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await mapIdle(page);
  await page.locator('#search').fill('bulevar');
  await expect.poll(() => renderedResultMarkerIds(page)).toEqual(QUERY_RESULT_IDS);
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(QUERY_RESULT_IDS);
  await expect.poll(() => renderedPlaceIds(page)).toEqual(FOOD_PLACE_IDS);

  await page.locator('#search').evaluate(element => element.blur());
  await page.goBack();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect(page.locator('#search')).toHaveValue('bulevar');
  await expect.poll(() => renderedResultMarkerIds(page)).toEqual(QUERY_RESULT_IDS);
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(QUERY_RESULT_IDS);
  await expect.poll(() => renderedPlaceIds(page)).toEqual(FOOD_PLACE_IDS);
});

test('a Mobile map tap keeps unmatching places while the query stays in the compact strip', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await mapIdle(page);
  await page.locator('#search').fill('bulevar');
  await expect.poll(() => renderedResultMarkerIds(page)).toEqual(QUERY_RESULT_IDS);
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(QUERY_RESULT_IDS);
  await expect.poll(() => renderedPlaceIds(page)).toEqual(FOOD_PLACE_IDS);

  // The bubble covers the upper map, so tap a clear point in the lower half rather than a place or building.
  const emptyMapPoint = await page.evaluate(() => {
    const map = window.kompasDebug.map;
    const canvas = map.getCanvas();
    const layers = map
      .getStyle()
      .layers.map(layer => layer.id)
      .filter(id => /^(place-|search-place|search-result-places|buildings|building-addresses)/.test(id));
    for (const [horizontal, vertical] of [
      [0.5, 0.8],
      [0.25, 0.75],
      [0.75, 0.75],
      [0.5, 0.7]
    ]) {
      const point = {x: canvas.clientWidth * horizontal, y: canvas.clientHeight * vertical};
      if (map.queryRenderedFeatures([point.x, point.y], {layers}).length) continue;
      const bounds = canvas.getBoundingClientRect();
      return {x: bounds.left + point.x, y: bounds.top + point.y};
    }
    return null;
  });
  expect(emptyMapPoint).not.toBeNull();
  await page.mouse.click(emptyMapPoint.x, emptyMapPoint.y);
  await expect(page.locator('#results-strip')).toBeVisible();
  await expect(page.locator('#search')).toHaveValue('bulevar');
  await expect.poll(() => renderedResultMarkerIds(page)).toEqual(QUERY_RESULT_IDS);
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(QUERY_RESULT_IDS);
  await expect.poll(() => renderedPlaceIds(page)).toEqual(FOOD_PLACE_IDS);
});

test('a category hides other categories while its query keeps nonmatching places', async ({page}) => {
  await page.route('**/data/places.geojson', route =>
    route.fulfill({
      json: {
        type: 'FeatureCollection',
        features: [PLACE, SECOND_PLACE, LOW_LEVEL_MATCH, HIGH_LEVEL_MATCH, NON_FOOD_PLACE]
      }
    })
  );
  await ready(page);
  await page.evaluate(coordinates => window.kompasDebug.map.jumpTo({center: coordinates, zoom: 17}), CENTRE);
  await mapIdle(page);
  const allPlaceIds = [...FOOD_PLACE_IDS, 'node/5'];
  await expect.poll(() => renderedPlaceIds(page)).toEqual(allPlaceIds);

  await page.locator('#search').fill('bulevar');
  await page.locator('#categories button[data-category="food"]').click();
  await expect.poll(() => renderedResultMarkerIds(page)).toEqual(FOOD_PLACE_IDS);
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(QUERY_RESULT_IDS);
  await expect.poll(() => renderedPlaceIds(page)).toEqual(FOOD_PLACE_IDS);
});

test('result highlights survive closing the dock and a place card', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await mapIdle(page);
  await page.locator('#search').fill('bulevar');
  await expectQueryHighlights(page);

  // Tap a building that is not itself a result, so its red card must not replace a green mark.
  const otherBuilding = secondAddress().geometry.coordinates;
  expect(await isInView(page, otherBuilding)).toBe(true);
  const point = await pointOnMap(page, otherBuilding);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#place-name')).toHaveText('Building 13');
  await expectQueryHighlights(page);

  await closeCard(page);
  await expect(page.locator('#place-card')).toBeHidden();
  await expect(page.locator('#search')).toHaveValue('bulevar');
  await expectQueryHighlights(page);

  await page.locator('#menu-toggle').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
  await expectQueryHighlights(page);
  await closeMenu(page);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expectQueryHighlights(page);
});

// A fresh Flip journey keeps its own camera and dock path; the phone journey above cannot carry those highlights over.
test('Flip keeps result highlights with the dock open and after it closes', {tag: '@phone'}, async ({page}) => {
  await withFlipViewport(page, async () => {
    await mapIdle(page);
    await page.locator('#menu-toggle').click();
    await expect(page.locator('body')).toHaveAttribute('data-view', 'dock');
    await page.locator('#search').fill('bulevar');
    await expectQueryHighlights(page);

    await closeMenu(page);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await expect(page.locator('#search')).toHaveValue('bulevar');
    await expectQueryHighlights(page);
  });
});

test('Flip keeps category highlights after the dock closes', {tag: '@phone'}, async ({page}) => {
  await withFlipViewport(page, async () => {
    await mapIdle(page);
    await page.locator('#menu-toggle').click();
    await page.locator('#categories button[data-category="food"]').click();
    const expected = ['node/1', 'node/2', 'node/3', 'node/4'];
    await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(expected);

    await closeMenu(page);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
    await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(expected);
  });
});

test('closing Mobile search keeps result highlights while the query stays in the bar', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  await page.locator('#search').fill('bulevar');
  await expect.poll(async () => (await highlightState(page)).buildings).toEqual([4]);
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(['node/1', 'node/2']);

  // Blur first: Escape on the focused search input natively clears it and reopens the bubble.
  await page.locator('#search').evaluate(element => element.blur());
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect(page.locator('#search')).toHaveValue('bulevar');
  await expect.poll(async () => (await highlightState(page)).buildings).toEqual([4]);
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(['node/1', 'node/2']);
});

test('category highlights stay on Mobile with search closed', {tag: ['@phone', '@phone-only']}, async ({page}) => {
  const expected = ['node/1', 'node/2', 'node/3', 'node/4'];
  await page.locator('#search').click();
  await page.locator('#categories button[data-category="food"]').click();
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(expected);

  await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect(page.locator('#categories button[data-category="food"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(expected);

  // Clearing both the category and the empty query removes the marks.
  await page.locator('#active-category-chip-remove').click();
  await expect.poll(async () => (await highlightState(page)).rings).toEqual([]);
});

test('a Desktop map pick keeps category highlights with search closed', async ({page}) => {
  const expected = ['node/1', 'node/2', 'node/3', 'node/4'];
  await page.locator('#search').click();
  await page.locator('#categories button[data-category="food"]').click();
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(expected);

  await page.locator('#clear-search').click();
  await expect(page.locator('#search')).toHaveValue('');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(expected);

  // Pick a building that is not itself a result, so the red card must not replace a green ring.
  const otherBuilding = secondAddress().geometry.coordinates;
  const point = await pointOnMap(page, otherBuilding);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#place-name')).toHaveText('Building 13');
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(expected);
  await closeCard(page);
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(expected);
});

test('a picked category draws and rings every in-view result at zoom 12', async ({page}) => {
  const coordinates = [
    PLACE.geometry.coordinates,
    SECOND_PLACE.geometry.coordinates,
    LOW_LEVEL_MATCH.geometry.coordinates,
    HIGH_LEVEL_MATCH.geometry.coordinates
  ];
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.2607, 42.4419], zoom: 12}));
  await mapIdle(page);
  await page.locator('#search').click();
  await page.locator('#categories button[data-category="food"]').click();
  await expect(page.locator('.result')).toHaveCount(4);
  const visible = await Promise.all(coordinates.map(point => isInView(page, point)));
  expect(visible).toEqual([true, true, true, true]);

  const expected = ['node/1', 'node/2', 'node/3', 'node/4'];
  await expect.poll(() => renderedResultMarkerIds(page)).toEqual(expected);
  await expect.poll(async () => (await highlightState(page)).rings.sort()).toEqual(expected);
});

test('without a query or category, below-threshold places keep their normal visibility', async ({page}) => {
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.2607, 42.4419], zoom: 12}));
  await mapIdle(page);
  await expect.poll(() => renderedPlaceIds(page)).toEqual(['node/3']);
  expect(await renderedResultMarkerIds(page)).toEqual([]);
  expect((await highlightState(page)).rings).toEqual([]);
});

test('choosing a building result replaces its green outline with the red selection', async ({page}) => {
  await page.locator('#search').fill('bulevar');
  await expect(page.locator('.result[data-kind="address"]')).toHaveCount(1);
  await page.locator('.result[data-kind="address"]').click();
  await expect(page.locator('#place-name')).toHaveText('Building 18');
  await expect(page.locator('#place-category')).toHaveText('Building');
  await expect(page.locator('#place-details .section-title')).toHaveText([
    'Addresses',
    'Inside this building',
    'Details'
  ]);
  await expect(page.locator('#place-details')).toContainText('Bulevar Stanka Dragojevića 18');
  await expect
    .poll(() =>
      page.evaluate(() => JSON.stringify(window.kompasDebug.map.getFilter('selected-buildings-outline')))
    )
    .toBe(JSON.stringify(['==', ['id'], 4]));
  await expect
    .poll(async () => (await highlightState(page)).buildings)
    .toEqual([]);
  // Places' green rings are still there: only the chosen result turned red.
  expect((await highlightState(page)).rings.sort()).toEqual(['node/1', 'node/2']);
});

test('an off-screen building result lists places after its reveal', async ({page}) => {
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.8, 42.8], zoom: 12}));
  await mapIdle(page);
  await page.locator('#search').fill('bulevar');
  const result = page.locator('.result[data-kind="address"]');
  await expect(result).toHaveCount(1);
  await result.click();
  await expect(page.locator('#place-name')).toHaveText('Building 18');
  await expect(page.locator('#place-details .details-section--inside-this-building .detail-value')).toHaveText([
    'Bulevar Cafe · Café',
    'Bulevar Market · Market',
    'Threshold Cafe · Café'
  ]);
});

test('closing Open results keeps category highlights and the category filter', {tag: '@phone'}, async ({page}) => {
  await page.locator('#search').fill('bulevar');
  await page.locator('#categories button[data-category="food"]').click();
  await expect(page.locator('.result')).toHaveCount(2);
  await expect
    .poll(async () => (await highlightState(page)).rings.sort())
    .toEqual(['node/1', 'node/2']);

  // Clearing a Filled query keeps the category and expands its marks to every in-view food place.
  await page.locator('#clear-search').click();
  await expect(page.locator('#search')).toHaveValue('');
  await expect
    .poll(async () => (await highlightState(page)).rings.sort())
    .toEqual(['node/1', 'node/2', 'node/3', 'node/4']);

  // Closing Open results leaves the category active, so its marks stay with the search state.
  await page.locator('#clear-search').click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'closed');
  await expect
    .poll(async () => (await highlightState(page)).rings.sort())
    .toEqual(['node/1', 'node/2', 'node/3', 'node/4']);
  await expect(page.locator('#categories button[data-category="food"]')).toHaveAttribute('aria-pressed', 'true');
});

test('choosing an off-screen address reveals it and zooms to street level', async ({page}) => {
  const target = FAR_ADDRESS.geometry.coordinates;
  await page.evaluate(center => window.kompasDebug.map.jumpTo({center, zoom: 12}), CENTRE);
  await settled(page);
  const before = await camera(page);
  await page.locator('#search').fill('77');
  await expect(page.locator('.result')).toHaveCount(1);
  await expect.poll(() => isInView(page, target)).toBe(false);
  await page.locator('.result').click();
  await expect.poll(() => isInView(page, target)).toBe(true);
  await settled(page);
  const after = await camera(page);
  expect(after.center).not.toEqual(before.center);
  expect(after.zoom).toBeGreaterThanOrEqual(15);
});

test('an address in the focus zone opens the map-tap card without moving the camera', async ({page}) => {
  await page.locator('#search').fill('13');
  await expect(page.locator('.result')).toHaveCount(1);
  await settled(page);
  await mapIdle(page);
  const before = await camera(page);
  await page.locator('.result').click();
  await expect(page.locator('#place-name')).toHaveText('Building 13');
  await expect(page.locator('#place-details')).toContainText('Njegoševa ulica 13');
  const fromResult = await page.locator('#place-name').innerText();
  const detailsFromResult = await detailsLines(page);
  await expectCameraToHold(page, before);
  await closeCard(page);
  await tapMapCenter(page, secondAddress().geometry.coordinates);
  await expect(page.locator('#place-name')).toHaveText(fromResult);
  expect(await detailsLines(page)).toEqual(detailsFromResult);
});

test('the list order survives a building card', async ({page}) => {
  await page.locator('#search').fill('bulevar');
  await expect(page.locator('.result').first()).toHaveAttribute('data-id', 'footprint/4');
  await page.locator('.result[data-kind="address"]').click();
  await expect(page.locator('#place-name')).toBeVisible();
  await page.evaluate(() => window.kompasDebug.map.jumpTo({center: [19.26085, 42.44205], zoom: 17}));
  await settled(page);
  await expect(page.locator('.result').first()).toHaveAttribute('data-id', 'footprint/4');
});

test('tapping a highlighted building removes its green fringe', async ({page}) => {
  await page.locator('#search').fill('13');
  await expect.poll(async () => (await highlightState(page)).buildings).toEqual([5]);
  await tapMapCenter(page, secondAddress().geometry.coordinates);
  await expect(page.locator('#place-name')).toBeVisible();
  await expect.poll(async () => (await highlightState(page)).buildings).toEqual([]);
});

// ---------------------------------------------------------------------------
// GPS distances (issue #262): a row's distance is from the fix, never the map centre.
// ---------------------------------------------------------------------------

const FIRST_GPS_FIX = {latitude: 42.44205, longitude: 19.26085, accuracy: 18};
const SECOND_GPS_FIX = {latitude: 42.4419, longitude: 19.2607, accuracy: 19};
test('GPS distances: without a usable fix rows keep centre order and show no distance', {tag: '@phone'}, async ({page}) => {
  await expect
    .poll(() => page.locator('#position-badge').getAttribute('data-state'))
    .not.toBe('live');
  await mapIdle(page);
  const expectedStreetNames = await streetNamesForQuery(page, 'bulevar');
  expect(expectedStreetNames).toContain('Bulevar Stanka Dragojevića');
  await page.locator('#search').fill('bulevar');
  await expect.poll(() => nonStreetRowIds(page)).toEqual(['footprint/4', 'node/1', 'node/2']);
  await expect(page.locator('.result')).toHaveCount(3 + expectedStreetNames.length);
  await expect(page.locator('.result .distance')).toHaveCount(0);
});

test.describe('GPS distances with a fix', () => {
  test.use({permissions: ['geolocation'], geolocation: FIRST_GPS_FIX});

  test('GPS distances: a live fix supplies the order and the distance text', {tag: '@phone'}, async ({
    page,
    context
  }) => {
    await context.setGeolocation(FIRST_GPS_FIX);
    await expect(page.locator('#position-badge')).toHaveAttribute('data-state', 'live');
    await mapIdle(page);
    const expectedStreetNames = await streetNamesForQuery(page, 'bulevar');
    expect(expectedStreetNames).toContain('Bulevar Stanka Dragojevića');
    await page.locator('#search').fill('bulevar');
    await expect(page.locator('.result')).toHaveCount(3 + expectedStreetNames.length);
    // The fix sits on node/2: it becomes nearest even though the map centre sits on footprint/4.
    await expect.poll(() => nonStreetRowIds(page)).toEqual(['node/2', 'node/1', 'footprint/4']);
    await expect(page.locator('.result .distance')).toHaveCount(3 + expectedStreetNames.length);
    await expect(page.locator('.result[data-id="node/2"] .distance')).toHaveText('0 m');
    await expect(page.locator('.result[data-id="footprint/4"] .distance')).toHaveText(/^\d+ m$/);
  });

  test('GPS distances: a changed fix refreshes rows but a card freezes them', async ({page, context}) => {
    await context.setGeolocation(FIRST_GPS_FIX);
    await expect(page.locator('#position-badge')).toHaveAttribute('data-state', 'live');
    await page.locator('#search').fill('bulevar');
    await expect.poll(() => nonStreetRowIds(page)).toEqual(['node/2', 'node/1', 'footprint/4']);
    await page.locator('.result[data-id="node/2"]').click();
    await expect(page.locator('#place-name')).toBeVisible();

    await context.setGeolocation(SECOND_GPS_FIX);
    await expect(page.locator('#position-status')).toHaveText(/±19 m/);
    await expectToHold(
      async () => expect(await nonStreetRowIds(page)).toEqual(['node/2', 'node/1', 'footprint/4']),
      CAMERA_HOLD_MILLISECONDS
    );

    await closeCard(page);
    await expect.poll(() => nonStreetRowIds(page)).toEqual(['footprint/4', 'node/1', 'node/2']);
    await expect(page.locator('.result[data-id="footprint/4"] .distance')).toHaveText('0 m');
  });

  test('GPS distances: switching cards keeps the deferred order frozen until the card closes', async ({
    page,
    context
  }) => {
    await context.setGeolocation(FIRST_GPS_FIX);
    await expect(page.locator('#position-badge')).toHaveAttribute('data-state', 'live');
    await page.locator('#search').fill('bulevar');
    await expect.poll(() => nonStreetRowIds(page)).toEqual(['node/2', 'node/1', 'footprint/4']);
    await page.locator('.result[data-id="node/2"]').click();
    await expect(page.locator('#place-name')).toHaveText('Bulevar Market');

    await context.setGeolocation(SECOND_GPS_FIX);
    await expect(page.locator('#position-status')).toHaveText(/±19 m/);
    await page.locator('.result[data-id="node/1"]').click();
    await expect(page.locator('#place-name')).toHaveText('Bulevar Cafe');
    await expectToHold(
      async () => expect(await nonStreetRowIds(page)).toEqual(['node/2', 'node/1', 'footprint/4']),
      CAMERA_HOLD_MILLISECONDS
    );

    await closeCard(page);
    await expect.poll(() => nonStreetRowIds(page)).toEqual(['footprint/4', 'node/1', 'node/2']);
  });
});
