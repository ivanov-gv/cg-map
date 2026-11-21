import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  cardDragFrame,
  cardStateAfterDrag,
  cardStateAfterSwipe,
  cardStateAfterSwipeWithoutFullscreen,
  cardStateForDeviceClass,
  detailsGeometryForMap,
  isActiveChipVisible,
  doesCardReachLocateColumn,
  freeMapAreas,
  isClearButtonVisible,
  isDockFooterVisible,
  isInFocusZone,
  isQueryChipVisible,
  phoneCardSteps,
  searchBarState,
  searchBounds,
  hasActiveSearchFilter,
  uncoveredMapArea,
  uncoveredMapOffset,
  viewForDeviceClass
} from '../src/interface.js';
import {
  DESKTOP_MEDIA_QUERY,
  deviceClass,
  FLIP_MEDIA_QUERY,
  MOBILE_MEDIA_QUERY
} from '../src/device-class.js';

test('search bar state follows the query and whether results are open', () => {
  assert.equal(searchBarState({hasQuery: false, resultsVisible: false}), 'empty');
  assert.equal(searchBarState({hasQuery: false, resultsVisible: true}), 'open');
  assert.equal(searchBarState({hasQuery: true, resultsVisible: true}), 'filled');
  // A query still shown after leaving a dock stays Filled until it is cleared.
  assert.equal(searchBarState({hasQuery: true, resultsVisible: false}), 'filled');
});

test('the clear button is Filled-only on Flip and Open as well as Filled elsewhere', () => {
  assert.equal(isClearButtonVisible({state: 'empty', isFlipLayout: false}), false);
  assert.equal(isClearButtonVisible({state: 'open', isFlipLayout: false}), true);
  assert.equal(isClearButtonVisible({state: 'filled', isFlipLayout: false}), true);
  assert.equal(isClearButtonVisible({state: 'open', isFlipLayout: true}), false);
  assert.equal(isClearButtonVisible({state: 'filled', isFlipLayout: true}), true);
});

test('the map chip replaces the category row only where search and the dock are closed', () => {
  const onMap = {hasCategory: true, view: 'closed', cardState: undefined, cardHidden: true};
  assert.equal(isActiveChipVisible({...onMap, isDesktopLayout: false}), true);
  assert.equal(isActiveChipVisible({...onMap, isDesktopLayout: true}), false, 'desktop row stays visible');
  assert.equal(isActiveChipVisible({...onMap, hasCategory: false}), false, 'All has no chip');
  assert.equal(isActiveChipVisible({...onMap, view: 'dock'}), false, 'dock row shows it');
  assert.equal(isActiveChipVisible({...onMap, view: 'search'}), false, 'bubble row shows it');
  assert.equal(
    isActiveChipVisible({...onMap, cardHidden: false, cardState: 'full'}),
    true,
    'a phone full card leaves the chip above it'
  );
  assert.equal(
    isActiveChipVisible({...onMap, cardHidden: false, cardState: 'fullscreen'}),
    false,
    'a fullscreen card hides it with the header'
  );
  assert.equal(
    isActiveChipVisible({...onMap, cardHidden: false, cardState: 'peek'}),
    true,
    'a phone peek leaves it available'
  );
  assert.equal(
    isActiveChipVisible({...onMap, cardHidden: false, cardState: 'peek', isFlipLayout: true}),
    false,
    'a Flip peek covers it too'
  );
});

test('the Flip query chip only stands in for the search row beside an unobstructed map', () => {
  const onCoverScreen = {hasQuery: true, view: 'closed', cardHidden: true, isFlipLayout: true};
  assert.equal(isQueryChipVisible(onCoverScreen), true);
  assert.equal(isQueryChipVisible({...onCoverScreen, hasQuery: false}), false, 'no query, no chip');
  assert.equal(isQueryChipVisible({...onCoverScreen, view: 'dock'}), false, 'dock has its own row');
  assert.equal(isQueryChipVisible({...onCoverScreen, view: 'search'}), false, 'bubble has its own row');
  assert.equal(isQueryChipVisible({...onCoverScreen, cardHidden: false}), false, 'a card covers it');
  assert.equal(isQueryChipVisible({...onCoverScreen, isFlipLayout: false}), false, 'Mobile is unchanged');
});

test('the Flip list screen never shows the dock footer, whatever the keyboard does', () => {
  for (const isKeyboardOpen of [false, true]) {
    assert.equal(
      isDockFooterVisible({isFlipLayout: true, isDockOpen: true, flipDockScreen: 'list', isKeyboardOpen}),
      false
    );
  }
  assert.equal(
    isDockFooterVisible({isFlipLayout: true, isDockOpen: true, flipDockScreen: 'modes', isKeyboardOpen: false}),
    true
  );
});

test('other layouts keep the footer unless a keyboard covers it', () => {
  assert.equal(
    isDockFooterVisible({isFlipLayout: false, isDockOpen: true, flipDockScreen: null, isKeyboardOpen: false}),
    true
  );
  assert.equal(
    isDockFooterVisible({isFlipLayout: false, isDockOpen: false, flipDockScreen: null, isKeyboardOpen: true}),
    false
  );
  assert.equal(
    isDockFooterVisible({isFlipLayout: true, isDockOpen: false, flipDockScreen: null, isKeyboardOpen: false}),
    true
  );
});

test('hasActiveSearchFilter reports a query, a category, or both', () => {
  for (const filter of [{hasQuery: true, hasCategory: false}, {hasQuery: false, hasCategory: true}]) {
    assert.equal(hasActiveSearchFilter(filter), true);
  }
  assert.equal(hasActiveSearchFilter({hasQuery: true, hasCategory: true}), true);
  assert.equal(hasActiveSearchFilter({hasQuery: false, hasCategory: false}), false);
});

test('folding maps panels to the other device and leaves an open card owning the Flip screen', () => {
  for (const view of ['search', 'dock']) {
    assert.deepEqual(viewForDeviceClass({view, flipDockScreen: null, hasCard: false, from: 'mobile', to: 'flip'}), {
      view: 'dock',
      flipDockScreen: 'list'
    });
    assert.deepEqual(viewForDeviceClass({view, flipDockScreen: null, hasCard: true, from: 'mobile', to: 'flip'}), {
      view: 'closed',
      flipDockScreen: null
    });
  }
  assert.deepEqual(
    viewForDeviceClass({view: 'closed', flipDockScreen: null, hasCard: false, from: 'mobile', to: 'flip'}),
    {view: 'closed', flipDockScreen: null}
  );
  for (const flipDockScreen of ['list', 'modes']) {
    assert.deepEqual(
      viewForDeviceClass({view: 'dock', flipDockScreen, hasCard: false, from: 'flip', to: 'mobile'}),
      {view: 'dock', flipDockScreen: null}
    );
  }
  assert.deepEqual(
    viewForDeviceClass({view: 'closed', flipDockScreen: null, hasCard: false, from: 'flip', to: 'mobile'}),
    {view: 'closed', flipDockScreen: null}
  );
  assert.deepEqual(
    viewForDeviceClass({
      view: 'closed',
      flipDockScreen: null,
      flipCardOrigin: 'dock',
      hasCard: true,
      from: 'flip',
      to: 'mobile'
    }),
    {view: 'search', flipDockScreen: null}
  );
  assert.deepEqual(
    viewForDeviceClass({
      view: 'closed',
      flipDockScreen: null,
      flipCardOrigin: 'map',
      hasCard: true,
      from: 'flip',
      to: 'mobile'
    }),
    {view: 'closed', flipDockScreen: null}
  );
  assert.deepEqual(
    viewForDeviceClass({view: 'search', flipDockScreen: null, hasCard: false, from: 'mobile', to: 'mobile'}),
    {view: 'search', flipDockScreen: null}
  );
});

test('the card keeps its step across a fold except Full, which becomes Peek', () => {
  assert.equal(cardStateForDeviceClass({state: 'peek', to: 'flip'}), 'peek');
  assert.equal(cardStateForDeviceClass({state: 'full', to: 'flip'}), 'peek');
  assert.equal(cardStateForDeviceClass({state: 'fullscreen', to: 'flip'}), 'fullscreen');
  assert.equal(cardStateForDeviceClass({state: undefined, to: 'flip'}), 'peek');
  assert.equal(cardStateForDeviceClass({state: 'peek', to: 'mobile', from: 'flip'}), 'peek');
  assert.equal(cardStateForDeviceClass({state: 'full', to: 'mobile', from: 'flip'}), 'peek');
  assert.equal(cardStateForDeviceClass({state: 'fullscreen', to: 'mobile', from: 'flip'}), 'fullscreen');
  assert.equal(cardStateForDeviceClass({state: undefined, to: 'mobile', from: 'desktop', view: 'search'}), 'peek');
  assert.equal(cardStateForDeviceClass({state: undefined, to: 'mobile', from: 'desktop', view: 'dock'}), 'full');
  assert.equal(cardStateForDeviceClass({state: 'peek', to: 'desktop'}), null);
});

test('search bubble stays within half the visible viewport, including keyboard and scroll offsets', () => {
  for (const height of [840, 500, 420, 240, 100]) {
    const bounds = searchBounds({height, top: 25});
    assert.equal(bounds.top, 107);
    assert.ok(bounds.maxHeight <= height / 2);
    assert.ok(bounds.maxHeight >= 0);
    if (height >= 164) assert.equal(bounds.top + bounds.maxHeight, 25 + height / 2);
  }
});

test('search bounds uses barHeight to position the bubble', () => {
  // Default barHeight is 54; with inset 12 and gapBelowBar 16, headerBottom = 82.
  const defaultBounds = searchBounds({height: 840, top: 0});
  assert.equal(defaultBounds.top, 82);
  // Mobile bar is 44 px tall; headerBottom = 12 + 44 + 16 = 72.
  const mobileBounds = searchBounds({height: 840, top: 0, barHeight: 44});
  assert.equal(mobileBounds.top, 72);
  // Desktop bar is 60 px tall; headerBottom = 12 + 60 + 16 = 88.
  const desktopBounds = searchBounds({height: 840, top: 0, barHeight: 60});
  assert.equal(desktopBounds.top, 88);
});

test('search target stays below bubble and above keyboard without changing the map container', () => {
  for (const visibleHeight of [840, 420]) {
    const bounds = searchBounds({height: visibleHeight, top: 25});
    const searchBottom = bounds.top + bounds.maxHeight;
    const offset = uncoveredMapOffset({
      width: 412,
      height: 840,
      visibleTop: 25,
      visibleHeight,
      headerBottom: 91,
      searchBottom
    });
    const point = [206 + offset[0], 420 + offset[1]];
    assert.ok(point[0] > 16 && point[0] < 340);
    assert.ok(point[1] > searchBottom);
    assert.ok(point[1] < visibleHeight + 25 - 20);
  }
});

test('selected point stays above the phone and desktop details cards', () => {
  const phone = uncoveredMapOffset({
    width: 412,
    height: 840,
    headerBottom: 66,
    details: {top: 480}
  });
  assert.ok(420 + phone[1] > 82 && 420 + phone[1] < 464);
  const desktop = uncoveredMapOffset({
    width: 1280,
    height: 800,
    headerBottom: 74,
    dockRight: 400,
    details: {left: 420, right: 1420, top: 528, bottom: 780},
    coversBottom: false
  });
  assert.ok(640 + desktop[0] > 416 && 640 + desktop[0] < 1208);
  assert.ok(400 + desktop[1] > 90 && 400 + desktop[1] < 484);
});

test('focus zone is the inner 75% of the uncovered map width and height', () => {
  const area = {left: 100, right: 500, top: 200, bottom: 600};
  const inside = [
    {x: 300, y: 400},
    {x: 150, y: 250},
    {x: 450, y: 550}
  ];
  const outside = [
    {x: 149, y: 400},
    {x: 451, y: 400},
    {x: 300, y: 249},
    {x: 300, y: 551}
  ];
  for (const point of inside) assert.equal(isInFocusZone(point, area), true, JSON.stringify(point));
  for (const point of outside) assert.equal(isInFocusZone(point, area), false, JSON.stringify(point));
});

test('a place under a panel is never inside the focus zone', () => {
  const phone = uncoveredMapArea({
    width: 412,
    height: 840,
    headerBottom: 66,
    searchBottom: 420,
    details: {top: 742}
  });
  assert.equal(isInFocusZone({x: 178, y: 300}, phone), false, 'under the results');
  assert.equal(isInFocusZone({x: 178, y: 790}, phone), false, 'under the card');
  assert.equal(isInFocusZone({x: 178, y: 580}, phone), true);
  const desktop = uncoveredMapArea({
    width: 1280,
    height: 800,
    headerBottom: 74,
    dockRight: 400,
    details: {left: 420, right: 1420, top: 528, bottom: 780},
    coversBottom: false
  });
  assert.equal(isInFocusZone({x: 200, y: 400}, desktop), false, 'under the dock');
  assert.equal(isInFocusZone({x: 600, y: 700}, desktop), false, 'under the card');
  assert.equal(isInFocusZone({x: 1000, y: 400}, desktop), true);
});

test('a floating desktop card is an obstacle rather than a bottom-wide cut', () => {
  const geometry = {
    width: 1440,
    height: 900,
    headerBottom: 96,
    details: {left: 220, right: 1220, top: 628, bottom: 880},
    coversBottom: false
  };
  const area = uncoveredMapArea(geometry);
  assert.equal(area.bottom, 880, 'the map below the card is still available beside it');
  assert.equal(isInFocusZone({x: 900, y: 650}, area), false, 'under the card');
  assert.equal(isInFocusZone({x: 120, y: 700}, area), true, 'beside the card');
  assert.equal(isInFocusZone({x: 900, y: 300}, area), true);
  assert.ok(uncoveredMapOffset(geometry)[1] < 0, 'camera aims above the card');
});

test('free map areas partition around the floating card without overlap', () => {
  const area = uncoveredMapArea({
    width: 1440,
    height: 900,
    headerBottom: 96,
    details: {left: 220, right: 1220, top: 628, bottom: 880},
    coversBottom: false
  });
  assert.deepEqual(freeMapAreas(area), [
    {left: 16, right: 1368, top: 112, bottom: 612},
    {left: 16, right: 204, top: 612, bottom: 880},
    {left: 1236, right: 1368, top: 612, bottom: 880}
  ]);
});

test('framing keeps entrance markers above a floating card', () => {
  const area = uncoveredMapArea({
    width: 900,
    height: 400,
    headerBottom: 96,
    searchBottom: 195,
    details: {left: 20, right: 880, top: 211, bottom: 380},
    coversBottom: false
  });
  assert.equal(area.framingBottom, 195);
  assert.ok(area.framingBottom < area.bottom);
});

test('a card covering every free map rectangle still gives the camera a finite offset', () => {
  const geometry = {
    width: 900,
    height: 400,
    headerBottom: 96,
    searchBottom: 195,
    details: {left: 20, right: 880, top: 211, bottom: 380},
    coversBottom: false
  };
  const area = uncoveredMapArea(geometry);
  assert.deepEqual(freeMapAreas(area), []);
  assert.deepEqual(uncoveredMapOffset(geometry), [
    (area.left + area.right) / 2 - geometry.width / 2,
    (area.top + area.bottom) / 2 - geometry.height / 2
  ]);
});

test('locate clearance follows the card column, not the card height', () => {
  const locateBox = {left: 1370, right: 1410};
  assert.equal(doesCardReachLocateColumn({left: 220, right: 1220}, locateBox), false);
  assert.equal(doesCardReachLocateColumn({left: 420, right: 1420}, locateBox), true);
  assert.equal(doesCardReachLocateColumn(null, locateBox), false);
});

test('swiping steps the phone card through peek, full, fullscreen, and closed', () => {
  const cases = [
    {state: 'peek', direction: 'up', resultsBehind: true, next: 'full'},
    {state: 'full', direction: 'up', resultsBehind: true, next: 'fullscreen'},
    {state: 'full', direction: 'up', resultsBehind: false, next: 'fullscreen'},
    {state: 'fullscreen', direction: 'up', resultsBehind: true, next: 'fullscreen'},
    {state: 'fullscreen', direction: 'down', resultsBehind: true, next: 'full'},
    {state: 'fullscreen', direction: 'down', resultsBehind: false, next: 'full'},
    {state: 'full', direction: 'down', resultsBehind: true, next: 'peek'},
    {state: 'full', direction: 'down', resultsBehind: false, next: 'closed'},
    {state: 'peek', direction: 'down', resultsBehind: true, next: 'closed'}
  ];
  for (const {next, ...swipe} of cases)
    assert.equal(cardStateAfterSwipe(swipe), next, JSON.stringify(swipe));
});

test('phone card steps share one geometry for the drag between every adjacent pair', () => {
  const steps = phoneCardSteps({viewportHeight: 840, bottomInset: 20, peekHeight: 80, fullHeight: 320});
  assert.deepEqual(steps.peek, {top: 740, height: 80, bottom: 820, inset: 12});
  assert.deepEqual(steps.full, {top: 500, height: 320, bottom: 820, inset: 12});
  assert.deepEqual(steps.fullscreen, {top: 0, height: 840, bottom: 840, inset: 0});

  const expanding = cardDragFrame({state: 'full', deltaYPixels: -125, resultsBehind: true, steps});
  assert.equal(expanding.targetState, 'fullscreen');
  assert.equal(expanding.rect.top, 375);
  assert.equal(expanding.rect.height, 450);
  assert.equal(expanding.rect.bottom, 825);
  assert.equal(expanding.rect.inset, 9);

  const sinking = cardDragFrame({state: 'fullscreen', deltaYPixels: 125, resultsBehind: true, steps});
  assert.equal(sinking.targetState, 'full');
  // The top edge follows the finger down; the card does not shrink from the bottom up.
  assert.equal(sinking.rect.top, 125);
  assert.ok(sinking.rect.height < steps.fullscreen.height);
  assert.ok(sinking.rect.bottom < steps.fullscreen.bottom);

  const revealing = cardDragFrame({state: 'peek', deltaYPixels: -120, resultsBehind: true, steps});
  assert.equal(revealing.targetState, 'full');
  assert.equal(revealing.rect.top, 620);
  assert.equal(revealing.rect.height, 200);
});

test('releasing a phone drag settles by distance, direction and velocity', () => {
  const steps = phoneCardSteps({viewportHeight: 840, bottomInset: 20, peekHeight: 80, fullHeight: 320});
  const settle = (options) => cardStateAfterDrag({resultsBehind: true, steps, ...options});

  // Half the distance to the adjacent step is the slow-drag threshold.
  assert.equal(settle({state: 'peek', deltaYPixels: -60, velocityPixelsPerMillisecond: 0}), 'peek');
  assert.equal(settle({state: 'peek', deltaYPixels: -130, velocityPixelsPerMillisecond: 0}), 'full');
  // A quick flick moves one step even when the finger travelled less than half the distance.
  assert.equal(settle({state: 'peek', deltaYPixels: -20, velocityPixelsPerMillisecond: -0.8}), 'full');
  assert.equal(settle({state: 'full', deltaYPixels: 20, velocityPixelsPerMillisecond: 0.8}), 'peek');
  // A flick in the opposite direction wins over a slow net movement.
  assert.equal(settle({state: 'peek', deltaYPixels: -130, velocityPixelsPerMillisecond: 0.8}), 'closed');
  assert.equal(settle({state: 'full', deltaYPixels: -20, velocityPixelsPerMillisecond: 0.8}), 'peek');
  assert.equal(settle({state: 'fullscreen', deltaYPixels: 20, velocityPixelsPerMillisecond: 0.8}), 'full');
  // Without results behind it, Full ends on the closed state.
  assert.equal(
    settle({state: 'full', resultsBehind: false, deltaYPixels: 20, velocityPixelsPerMillisecond: 0.8}),
    'closed'
  );
});

test('swiping steps the Flip/non-phone card through peek, full, and closed', () => {
  const cases = [
    {state: 'peek', direction: 'up', resultsBehind: true, next: 'full'},
    {state: 'full', direction: 'down', resultsBehind: true, next: 'peek'},
    {state: 'peek', direction: 'down', resultsBehind: true, next: 'closed'},
    {state: 'full', direction: 'down', resultsBehind: false, next: 'closed'}
  ];
  for (const {next, ...swipe} of cases)
    assert.equal(cardStateAfterSwipeWithoutFullscreen(swipe), next, JSON.stringify(swipe));
});

test('desktop details geometry keeps the card right edge, not the map edge', () => {
  const map = {left: 10, top: 5, width: 1280, height: 800};
  const details = {top: 94, right: 787, bottom: 400, left: 412, width: 375, height: 306};
  assert.deepEqual(detailsGeometryForMap(details, map, {detailsTop: 94, isFullscreenCard: false}), {
    top: 89,
    right: 777
  });
  assert.equal(detailsGeometryForMap(details, map, {detailsTop: 94, isFullscreenCard: true}), null);
});

test('device class distinguishes flip, mobile, and desktop by viewport size', () => {
  function fakeMatchMedia(width, height) {
    return (query) => {
      // Parse simple media queries: (max-width: Npx) and (max-height: Npx) or (max-width: Npx)
      const maxWidthMatch = query.match(/\(max-width:\s*(\d+)px\)/);
      const maxHeightMatch = query.match(/\(max-height:\s*(\d+)px\)/);
      const matchesWidth = !maxWidthMatch || width <= Number(maxWidthMatch[1]);
      const matchesHeight = !maxHeightMatch || height <= Number(maxHeightMatch[1]);
      return {matches: matchesWidth && matchesHeight};
    };
  }

  // Flip cover screens: small and nearly square (Galaxy Z Flip ~340-380 per side)
  assert.equal(deviceClass(fakeMatchMedia(340, 340)), 'flip');
  assert.equal(deviceClass(fakeMatchMedia(380, 380)), 'flip');
  assert.equal(deviceClass(fakeMatchMedia(400, 400)), 'flip');
  assert.equal(deviceClass(fakeMatchMedia(350, 390)), 'flip');

  // Phones in portrait: width ≤ 720, height > 400 → mobile
  assert.equal(deviceClass(fakeMatchMedia(360, 640)), 'mobile');
  assert.equal(deviceClass(fakeMatchMedia(412, 840)), 'mobile');

  // Edge: width ≤ 720 but height > 400 → mobile, not flip
  assert.equal(deviceClass(fakeMatchMedia(400, 401)), 'mobile');
  assert.equal(deviceClass(fakeMatchMedia(401, 400)), 'mobile');
  assert.equal(deviceClass(fakeMatchMedia(720, 800)), 'mobile');

  // Desktop: width > 720 (includes phones in landscape, e.g. 840×412)
  assert.equal(deviceClass(fakeMatchMedia(721, 480)), 'desktop');
  assert.equal(deviceClass(fakeMatchMedia(840, 412)), 'desktop');
  assert.equal(deviceClass(fakeMatchMedia(1280, 800)), 'desktop');
  assert.equal(deviceClass(fakeMatchMedia(1920, 1080)), 'desktop');
});

test('desktop and mobile queries are complements', () => {
  const desktopMatch = DESKTOP_MEDIA_QUERY.match(/min-width:\s*(\d+)px/);
  const mobileMatch = MOBILE_MEDIA_QUERY.match(/max-width:\s*(\d+)px/);
  assert.ok(desktopMatch, 'DESKTOP_MEDIA_QUERY should contain min-width');
  assert.ok(mobileMatch, 'MOBILE_MEDIA_QUERY should contain max-width');
  const desktopMin = Number(desktopMatch[1]);
  const mobileMax = Number(mobileMatch[1]);
  assert.equal(desktopMin, mobileMax + 1, 'Desktop min-width should be mobile max-width + 1');
});

// Interaction-only media features describe input capability, not screen size.
// They are not breakpoints, so their @media rules are not checked against device-class queries.
const interactionMediaFeatures = ['hover', 'any-hover', 'pointer', 'any-pointer'];

// Layout media features that would turn a condition into a breakpoint.
const layoutMediaFeatures = ['width', 'height', 'aspect-ratio', 'orientation'];

/**
 * Returns true when every media feature in the condition is an interaction feature.
 * A condition like "(hover: hover)" returns true; "(hover: hover) and (max-width: 720px)" returns false.
 */
function isInteractionOnlyCondition(condition) {
  // Split on 'and'/'or' to get individual feature parens, then extract feature names.
  const featureTokens = condition.match(/\(\s*(\w[\w-]*)\s*[^)]*\)/g) ?? [];
  const featureNames = featureTokens.map(token => {
    const nameMatch = token.match(/\(\s*(\w[\w-]*)\s*:/);
    return nameMatch ? nameMatch[1] : null;
  }).filter(Boolean);

  // Every feature must be an interaction feature; if any are missing, it's mixed.
  const allInteraction = featureNames.length > 0 && featureNames.every(name => interactionMediaFeatures.includes(name));
  return allInteraction;
}

/**
 * Returns true if the condition contains any layout media feature (width, height, etc.).
 * Used to ensure that skipped conditions do not hide breakpoints.
 */
function hasLayoutFeature(condition) {
  return layoutMediaFeatures.some(feature => new RegExp(`\\b${feature}\\b`).test(condition));
}

test('style.css @media conditions match the exported device-class queries', () => {
  const css = fs.readFileSync(new URL('../public/style.css', import.meta.url), 'utf8');

  // Strip comments so the regex only sees real rules.
  const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Find all @media conditions in the CSS.
  const mediaPattern = /@media\s+([^{]+)\{/g;
  const deviceQueries = [FLIP_MEDIA_QUERY, MOBILE_MEDIA_QUERY, DESKTOP_MEDIA_QUERY];
  let match;
  while ((match = mediaPattern.exec(cssWithoutComments)) !== null) {
    const condition = match[1].trim();

    // Skip prefers-* media queries (e.g. prefers-reduced-motion, prefers-color-scheme) —
    // they describe user preferences, not screen size.
    const isPrefersQuery = condition.includes('prefers-');
    // Skip interaction-only queries (e.g. hover: hover) — they describe input capability,
    // not screen size, so they are not breakpoints.
    const isInteractionOnly = isInteractionOnlyCondition(condition);

    if (isPrefersQuery || isInteractionOnly) {
      // Guard: a skipped condition must not contain a layout feature, otherwise it could
      // hide a real breakpoint that should be checked against device-class queries.
      assert.ok(
        !hasLayoutFeature(condition),
        `Skipped @media condition "${condition}" contains a layout feature and may hide a breakpoint`
      );
      continue;
    }

    const isKnownQuery = deviceQueries.some(query => condition === query);
    assert.ok(isKnownQuery, `style.css @media condition "${condition}" does not match any exported device-class query`);
  }
});

test('interaction-only conditions are skipped but mixed conditions are rejected', () => {
  // Pure interaction conditions should be classified as interaction-only.
  assert.equal(isInteractionOnlyCondition('(hover: hover)'), true);
  assert.equal(isInteractionOnlyCondition('(any-pointer: fine)'), true);
  assert.equal(isInteractionOnlyCondition('(hover: hover) and (pointer: fine)'), true);

  // A condition that mixes interaction and layout features is NOT interaction-only.
  assert.equal(isInteractionOnlyCondition('(hover: hover) and (max-width: 720px)'), false);
  assert.equal(isInteractionOnlyCondition('(max-width: 720px)'), false);

  // hasLayoutFeature detects layout features in a condition string.
  assert.equal(hasLayoutFeature('(hover: hover) and (max-width: 720px)'), true);
  assert.equal(hasLayoutFeature('(hover: hover)'), false);
  assert.equal(hasLayoutFeature('(min-width: 721px)'), true);
  assert.equal(hasLayoutFeature('(orientation: landscape)'), true);
});
