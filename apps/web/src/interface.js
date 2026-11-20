import {FLIP_MEDIA_QUERY} from './device-class.js';

// The bar is Empty without results, Open with results and no query, and Filled with a query.
export function searchBarState({hasQuery, resultsVisible}) {
  if (hasQuery) return 'filled';
  return resultsVisible ? 'open' : 'empty';
}

// Flip reserves × for clearing a query; its Icon Button owns closing the dock.
export function isClearButtonVisible({state, isFlipLayout}) {
  if (isFlipLayout) return state === 'filled';
  return state !== 'empty';
}

// The map chip replaces the category row while that row is off screen; an expanded card covers the map.
export function isActiveChipVisible({hasCategory, view, cardState, cardHidden, isDesktopLayout}) {
  if (isDesktopLayout || !hasCategory || view !== 'closed') return false;
  const isExpandedCard = !cardHidden && (cardState === 'full' || cardState === 'fullscreen');
  return !isExpandedCard;
}

// The Flip screen owns the footer: only ◇ Modes shows it, regardless of results or keyboard.
// Elsewhere the footer stays available unless the keyboard would cover it.
export function isDockFooterVisible({isFlipLayout, isDockOpen, flipDockScreen, isKeyboardOpen}) {
  if (isFlipLayout && isDockOpen) return flipDockScreen === 'modes';
  return !isKeyboardOpen;
}

// All geometry is in CSS pixels in the map container, including the keyboard's visible viewport.
export function searchBounds({height, top = 0, inset = 12, barHeight = 54}) {
  // Header, fixed categories, and results occupy the upper half of the unobscured screen.
  // 16 px is the space between the bar and the panel below it.
  const gapBelowBar = 16;
  const headerBottom = inset + barHeight + gapBelowBar;
  return {top: top + headerBottom, maxHeight: Math.max(0, height / 2 - headerBottom)};
}

// A phone card reaches the screen edge and shortens the map. A desktop card floats inside it as an obstacle.
const CARD_CLEARANCE_PIXELS = 16;

// The part of the map no panel covers, in map container pixels.
export function uncoveredMapArea({
  width,
  height,
  visibleTop = 0,
  visibleHeight = height,
  headerBottom = 0,
  searchBottom = 0,
  dockRight = 0,
  details = null,
  routeBottom = 0,
  coversBottom = true
}) {
  let left = Math.max(16, dockRight ? dockRight + 16 : 0);
  const right = width - 72;
  let top = Math.max(visibleTop + 16, headerBottom + 16, searchBottom + 16, routeBottom + 16);
  let bottom = Math.min(height - 20, visibleTop + visibleHeight - 20);
  const obstacles = [];
  if (details) {
    if (coversBottom) bottom = Math.min(bottom, details.top - CARD_CLEARANCE_PIXELS);
    else
      obstacles.push({
        left: details.left - CARD_CLEARANCE_PIXELS,
        right: details.right + CARD_CLEARANCE_PIXELS,
        top: details.top - CARD_CLEARANCE_PIXELS,
        bottom: details.bottom + CARD_CLEARANCE_PIXELS
      });
  }
  // Even when the card floats, framed entrances must stay above it rather than merely inside the map.
  const framingBottom = details ? Math.min(bottom, details.top - CARD_CLEARANCE_PIXELS) : bottom;
  left = Math.min(left, Math.max(16, right - 40));
  top = Math.min(top, Math.max(visibleTop + 16, bottom - 40));
  return {left, right, top, bottom, framingBottom, obstacles};
}

// Split one free rectangle where an obstacle crosses it: above, below, left and right of the obstacle.
function splitAroundObstacle(area, obstacle) {
  const leftEdge = Math.max(area.left, obstacle.left);
  const rightEdge = Math.min(area.right, obstacle.right);
  const topEdge = Math.max(area.top, obstacle.top);
  const bottomEdge = Math.min(area.bottom, obstacle.bottom);
  if (leftEdge >= rightEdge || topEdge >= bottomEdge) return [area];
  const pieces = [];
  if (area.top < topEdge) pieces.push({left: area.left, right: area.right, top: area.top, bottom: topEdge});
  if (bottomEdge < area.bottom) pieces.push({left: area.left, right: area.right, top: bottomEdge, bottom: area.bottom});
  if (area.left < leftEdge) pieces.push({left: area.left, right: leftEdge, top: topEdge, bottom: bottomEdge});
  if (rightEdge < area.right) pieces.push({left: rightEdge, right: area.right, top: topEdge, bottom: bottomEdge});
  return pieces;
}

// Returns the non-overlapping rectangles left uncovered by the panels and floating obstacles.
export function freeMapAreas(area) {
  const base = {left: area.left, right: area.right, top: area.top, bottom: area.bottom};
  const pieces = (area.obstacles ?? []).reduce(
    (currentAreas, obstacle) => currentAreas.flatMap(current => splitAroundObstacle(current, obstacle)),
    [base]
  );
  return pieces.filter(piece => piece.right > piece.left && piece.bottom > piece.top);
}

function rectangleArea({left, right, top, bottom}) {
  return (right - left) * (bottom - top);
}

export function uncoveredMapOffset(geometry) {
  const area = uncoveredMapArea(geometry);
  const areas = freeMapAreas(area);
  // A card can cover the whole free map, so fall back to the unpartitioned area.
  const largest = areas.length
    ? areas.reduce((best, candidate) => (rectangleArea(candidate) > rectangleArea(best) ? candidate : best))
    : area;
  const centreX = (largest.left + largest.right) / 2 - geometry.width / 2;
  const centreY = (largest.top + largest.bottom) / 2 - geometry.height / 2;
  return [centreX, centreY];
}

// A chosen place inside this share of one uncovered rectangle needs no camera move.
export const FOCUS_ZONE_RATIO = 0.75;

function isInsideFocusRectangle({x, y}, {left, right, top, bottom}) {
  const insetX = ((right - left) * (1 - FOCUS_ZONE_RATIO)) / 2;
  const insetY = ((bottom - top) * (1 - FOCUS_ZONE_RATIO)) / 2;
  return x >= left + insetX && x <= right - insetX && y >= top + insetY && y <= bottom - insetY;
}

export function isInFocusZone(point, area) {
  return freeMapAreas(area).some(free => isInsideFocusRectangle(point, free));
}

// The card reaches the Locate column when their horizontal spans overlap, whatever their vertical positions.
export function doesCardReachLocateColumn(cardBox, locateBox) {
  if (!cardBox || !locateBox) return false;
  return cardBox.right >= locateBox.left && cardBox.left <= locateBox.right;
}

// Swiping steps the phone card through peek, full and fullscreen. Swiping down
// from full returns to peek above results, or closes a card opened from the map.
export function cardStateAfterSwipe({state, direction, resultsBehind}) {
  if (direction === 'up') {
    if (state === 'peek') return 'full';
    return 'fullscreen';
  }
  if (state === 'fullscreen') return 'full';
  if (state === 'full') return resultsBehind ? 'peek' : 'closed';
  return 'closed';
}

// Flip and other non-phone layouts keep the earlier two-step card: up opens full,
// down from full returns to peek above results or closes, and down from peek closes.
export function cardStateAfterSwipeWithoutFullscreen({state, direction, resultsBehind}) {
  if (direction === 'up') return 'full';
  return state === 'full' && resultsBehind ? 'peek' : 'closed';
}

const PHONE_CARD_INSET_PIXELS = 12;
const PHONE_CARD_BOTTOM_GAP_PIXELS = 20;
// Only the last moments of a gesture decide whether it was a flick.
const FLICK_VELOCITY_WINDOW_MILLISECONDS = 100;
// A quick flick moves one step even when the finger barely travelled.
export const CARD_FLICK_VELOCITY_PIXELS_PER_MILLISECOND = 0.35;

// All settled steps share one coordinate system: the map container, whose top is the phone screen top.
// The bottom anchor is the card's resting edge; fullscreen has no gutter and reaches the screen bottom.
export function phoneCardSteps({viewportHeight, bottomInset, peekHeight, fullHeight}) {
  const bottom = viewportHeight - bottomInset;
  return {
    peek: {top: bottom - peekHeight, height: peekHeight, bottom, inset: PHONE_CARD_INSET_PIXELS},
    full: {top: bottom - fullHeight, height: fullHeight, bottom, inset: PHONE_CARD_INSET_PIXELS},
    fullscreen: {top: 0, height: viewportHeight, bottom: viewportHeight, inset: 0},
    closed: {top: bottom, height: 0, bottom, inset: PHONE_CARD_INSET_PIXELS}
  };
}

// Interpolates the card's whole rectangle towards the adjacent step. Fullscreen grows upward under the finger;
// coming back it sinks downward, so its top edge uncovers the map instead of its bottom edge rising.
export function cardDragFrame({state, deltaYPixels, resultsBehind, steps}) {
  const direction = deltaYPixels < 0 ? 'up' : 'down';
  const targetState = cardStateAfterSwipe({state, direction, resultsBehind});
  if (targetState === state) return null;
  const from = steps[state];
  const to = steps[targetState];
  const travelPixels = Math.abs(from.top - to.top);
  const progress = travelPixels ? Math.min(1, Math.abs(deltaYPixels) / travelPixels) : 1;
  const interpolate = (start, end) => start + (end - start) * progress;
  return {
    targetState,
    rect: {
      top: interpolate(from.top, to.top),
      height: interpolate(from.height, to.height),
      bottom: interpolate(from.bottom, to.bottom),
      inset: interpolate(from.inset, to.inset)
    }
  };
}

// Velocity is measured over the recent part of a gesture, so a short final pause cannot hide a flick.
function touchVelocityPixelsPerMillisecond(samples) {
  if (samples.length < 2) return 0;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const elapsedMilliseconds = last.time - first.time;
  return elapsedMilliseconds > 0 ? (last.y - first.y) / elapsedMilliseconds : 0;
}

// A slow drag settles only after halfway; a flick settles one step in its own direction.
export function cardStateAfterDrag({
  state,
  deltaYPixels,
  velocityPixelsPerMillisecond,
  resultsBehind,
  steps
}) {
  const isFlick = Math.abs(velocityPixelsPerMillisecond) >= CARD_FLICK_VELOCITY_PIXELS_PER_MILLISECOND;
  const movementPixels = isFlick ? velocityPixelsPerMillisecond : deltaYPixels;
  const direction = movementPixels < 0 ? 'up' : 'down';
  const targetState = cardStateAfterSwipe({state, direction, resultsBehind});
  if (targetState === state || isFlick) return targetState;
  const travelPixels = Math.abs(steps[state].top - steps[targetState].top);
  return Math.abs(deltaYPixels) >= travelPixels / 2 ? targetState : state;
}

// A non-fullscreen card keeps its own right edge in map geometry so the desktop focus zone stays beside it.
export function detailsGeometryForMap(detailsRect, mapRect, {detailsTop, isFullscreenCard}) {
  if (!detailsRect || isFullscreenCard) return null;
  return {top: detailsTop - mapRect.top, right: detailsRect.right - mapRect.left};
}

const DRAG_START_PIXELS = 6;
const FLIP_SWIPE_THRESHOLD_PIXELS = 24;
// One trackpad gesture fires many wheel events; it may change the card state only once.
const WHEEL_GESTURE_MILLISECONDS = 600;
// A smaller gap can be browser chrome rather than an on-screen keyboard.
const MINIMUM_KEYBOARD_HEIGHT_PIXELS = 100;

export class MapInterface {
  constructor({
    onSearch,
    onResultsRefreshed,
    onChange,
    onViewport,
    onCardSwipedAway,
    onResultsClosed,
    onRemoveCategory,
    activeCategoryLabel,
    resultsLabel
  }) {
    Object.assign(this, {
      onSearch,
      onResultsRefreshed,
      onChange,
      onViewport,
      onCardSwipedAway,
      onResultsClosed,
      onRemoveCategory,
      activeCategoryLabel,
      resultsLabel
    });
    this.initializeViewState();
    this.findControls();
    this.wireControls();
    this.wireLayoutChanges();
    this.startCardObserver();
    this.wireCardGestures();
    this.wireCategoryWheel();
    this.syncInitialUI();
  }

  initializeViewState() {
    this.view = 'closed';
    this.isResultsPanelOpen = false;
    this.areResultsMinimized = false;
    this.mobileLayoutQuery = matchMedia('(max-width: 720px)');
    this.flipLayoutQuery = matchMedia(FLIP_MEDIA_QUERY);
    this.isRestoringFocus = false;
    // On Flip, the menu button cycles through three screens; elsewhere it toggles the dock.
    // 'list' → dock open, results shown; 'modes' → dock open, modes menu shown.
    // When the dock is closed, flipDockScreen is null and view === 'closed'.
    this.flipDockScreen = null; // 'list' | 'modes' | null, meaningful only on Flip
  }

  findControls() {
    this.search = document.getElementById('search');
    this.menu = document.getElementById('menu-toggle');
    this.panel = document.getElementById('browse-panel');
    this.dock = document.getElementById('dock-content');
    this.dockMain = document.getElementById('dock-main');
    this.bubble = document.getElementById('search-bubble');
    this.strip = document.getElementById('results-strip');
    this.card = document.getElementById('place-card');
    this.cardHead = document.getElementById('place-head');
    this.cardBody = document.getElementById('place-body');
    this.cardHandle = document.getElementById('card-handle');
    this.clearButton = document.getElementById('clear-search');
    this.activeChip = document.getElementById('active-category-chip');
    this.activeChipLabel = document.getElementById('active-category-chip-label');
    this.activeChipRemove = document.getElementById('active-category-chip-remove');
    this.desktopSearchPanel = document.getElementById('desktop-search-panel');
    this.footer = document.querySelector('.dock-footer');
    this.trigger = this.menu;
  }

  wireControls() {
    this.menu.addEventListener('click', () => this.activateMenu());
    this.clearButton.addEventListener('click', () => this.clearQueryOrCloseResults());
    this.activeChipLabel.addEventListener('click', () => this.openChipTarget());
    this.activeChipRemove.addEventListener('click', () => this.onRemoveCategory?.());
    this.strip.addEventListener('click', () => this.setCardState('peek'));
    this.cardHandle.addEventListener('click', () => this.activateCardHandle());
    this.card.addEventListener('focusin', (event) => this.revealFocusedCardContent(event.target));
    this.cardHead.addEventListener('click', (event) => {
      if (!this.isMobilePhone || event.target.closest('button, a')) return;
      this.activateCardHandle();
    });
    this.wireSearchEvents();
  }

  // Wire the search input handlers. On Flip with the modes screen shown,
  // focus or typing switches to the list screen instead of opening search.
  wireSearchEvents() {
    for (const type of ['focus', 'click'])
      this.search.addEventListener(type, () => {
        if (!this.isRestoringFocus) {
          if (this.flipLayoutQuery.matches && this.flipDockScreen === 'modes') {
            this.flipDockScreen = 'list';
            this.syncDockContent();
            this.syncMenuIcon();
            this.onSearch?.();
            return;
          }
          this.openSearch();
        }
      });
    this.search.addEventListener('keydown', event => {
      const isSearchKey = event.key === 'Enter' && !event.isComposing;
      if (!isSearchKey || !this.mobileLayoutQuery.matches) return;
      // The phone keyboard's Search key hides the keyboard; the bubble or dock keeps the results.
      // Enter during IME composition confirms a candidate and must leave the field focused.
      event.preventDefault();
      this.search.blur();
    });
    this.search.addEventListener('input', () => {
      if (this.flipLayoutQuery.matches && this.flipDockScreen === 'modes') {
        this.flipDockScreen = 'list';
        this.syncDockContent();
        this.syncMenuIcon();
      }
      this.syncClearButton();
      this.syncDesktopSearchUI();
    });
  }

  // The three-step mobile card (peek, full, fullscreen) applies on phones, not Flip.
  get isMobilePhone() {
    return this.mobileLayoutQuery.matches && !this.flipLayoutQuery.matches;
  }

  // A menu click toggles the dock, or advances the three-state cycle on Flip.
  activateMenu() {
    this.trigger = this.menu;
    if (this.mobileLayoutQuery.matches) this.search.blur();
    if (this.flipLayoutQuery.matches) this.cycleFlipMenu();
    else this.setView(this.view === 'dock' ? 'closed' : 'dock');
    this.onViewport?.();
  }

  wireLayoutChanges() {
    this.mobileLayoutQuery.addEventListener('change', () => this.syncForMobileLayoutChange());
    this.flipLayoutQuery.addEventListener('change', () => this.syncForFlipLayoutChange());
    window.visualViewport?.addEventListener('resize', () => this.syncViewport());
    window.visualViewport?.addEventListener('scroll', () => this.syncViewport());
    window.addEventListener('resize', () => this.syncViewport());
  }

  // The panel's container and the standalone chip both change at the Mobile breakpoint.
  syncForMobileLayoutChange() {
    if (this.view === 'search' && !this.mobileLayoutQuery.matches) this.setView('dock');
    if (!this.card.hidden) this.syncCardForLayout();
    else this.syncMobileCardPresentation();
    this.syncPanelPosition();
    this.syncDesktopSearchUI();
    this.syncViewport();
    this.syncActiveChip();
  }

  // A device-class change re-derives the clear-button rule, the active chip and the Flip menu state.
  syncForFlipLayoutChange() {
    this.syncClearButton();
    this.syncActiveChip();
    this.syncDockContent();
    this.syncMenuIcon();
    if (!this.card.hidden) this.syncCardForLayout();
    else this.syncMobileCardPresentation();
  }

  startCardObserver() {
    this.observer = new ResizeObserver(() => {
      this.syncCardTouch();
      this.onViewport?.();
    });
    this.observer.observe(this.bubble);
    this.observer.observe(this.card);
  }

  syncInitialUI() {
    this.syncPanelPosition();
    this.syncDesktopSearchUI();
    this.syncViewport(false);
    this.syncActiveChip();
  }

  // Move the browse panel to the container for the current view without changing other state.
  syncPanelPosition() {
    this.movePanelTo(this.#panelTargetFor(this.view));
  }

  // Keep the category row's horizontal position when the one shared panel changes container.
  movePanelTo(target, scrollLeft = document.getElementById('categories').scrollLeft) {
    const categories = document.getElementById('categories');
    if (this.panel.parentElement !== target) target.append(this.panel);
    categories.scrollLeft = scrollLeft;
  }

  // Returns true when the search input has a non-empty query.
  hasQuery() {
    return this.search.value.trim().length > 0;
  }

  // The bar state combines query and result visibility; clear-button rules depend on the device.
  get state() {
    return searchBarState({hasQuery: this.hasQuery(), resultsVisible: this.areResultsVisible()});
  }

  syncClearButton() {
    // The slot stays in layout; only visibility and keyboard/a11y access change.
    const isVisible = isClearButtonVisible({
      state: this.state,
      isFlipLayout: this.flipLayoutQuery.matches
    });
    this.clearButton.dataset.clearVisible = String(isVisible);
    this.clearButton.setAttribute('aria-hidden', String(!isVisible));
    this.clearButton.tabIndex = isVisible ? 0 : -1;
  }

  // A chip tap opens the control that owns categories on this device: bubble on Phone, dock on Flip.
  openChipTarget() {
    if (this.flipLayoutQuery.matches) {
      // Reuse the menu button's toggle so focus and viewport bookkeeping stay in one place.
      this.menu.click();
      return;
    }
    this.openSearch();
  }

  // The chip mirrors the active category and only shows where the category row is off screen.
  syncActiveChip() {
    const label = this.activeCategoryLabel?.() ?? '';
    this.activeChipLabel.textContent = label;
    this.activeChipRemove.setAttribute('aria-label', label ? `Remove category ${label}` : 'Remove category');
    this.activeChip.hidden = !isActiveChipVisible({
      hasCategory: Boolean(label),
      view: this.view,
      cardState: this.card.dataset.state,
      cardHidden: this.card.hidden,
      isDesktopLayout: !this.mobileLayoutQuery.matches
    });
  }

  // Filled clears the query; Open closes results except on Flip, where the Icon Button owns dock closing.
  clearQueryOrCloseResults() {
    if (this.state === 'filled') {
      this.clearQuery();
      // Refocus without firing the focus handler, which would close the chosen place's card.
      this.restoreFocus(this.search);
      return;
    }
    if (this.flipLayoutQuery.matches) return;
    this.closeResults();
  }

  // Reveal results without taking focus from the control the person used.
  showResults() {
    this.isResultsPanelOpen = true;
    this.syncDesktopSearchUI();
    this.syncClearButton();
  }

  openSearch() {
    this.trigger = this.search;
    if (this.mobileLayoutQuery.matches) {
      // Mobile behavior: search bubble or dock.
      const view = this.view !== 'dock' ? 'search' : 'dock';
      const hasViewChanged = view !== this.view;
      this.setView(view);
      if (hasViewChanged) this.onSearch?.();
      else if (this.areResultsMinimized) this.setCardState('peek');
      return;
    }
    // Desktop: focusing reveals the joined results panel even with no query. The dock's state stays as it was.
    const wasOpen = this.areResultsVisible();
    this.showResults();
    this.setView(this.view);
    // Refreshing results is not a new search: a card chosen on the map must stay open.
    if (!wasOpen) this.onResultsRefreshed?.();
  }

  // Leave search entirely: hide results and the card, then return to the map.
  closeResults() {
    this.onResultsClosed?.();
    this.isResultsPanelOpen = false;
    this.trigger = this.menu;
    this.close(true);
  }

  // Returns the container the browse panel should live in for the given view.
  #panelTargetFor(view) {
    if (view === 'search') return this.bubble;
    if (!this.mobileLayoutQuery.matches && view === 'closed') return this.desktopSearchPanel;
    return this.dockMain;
  }

  setView(view) {
    const wasClosed = this.view === 'closed';
    // Capture before hiding a container, which would clamp the hidden row's scroll position to zero.
    const categoryScrollLeft = document.getElementById('categories').scrollLeft;
    this.view = view;
    // Closing a dock or bubble is a return to the map; a desktop focus refresh with the same view is not.
    if (view === 'closed' && !wasClosed) this.isResultsPanelOpen = false;
    if (view !== 'search') {
      this.areResultsMinimized = false;
      // A peek only makes sense above open results.
      if (this.card.dataset.state === 'peek') this.setCardState('full');
    }
    this.dock.hidden = view !== 'dock';
    this.syncResultsVisibility();
    this.syncDesktopSearchUI();
    this.movePanelTo(this.#panelTargetFor(view), categoryScrollLeft);
    this.syncClearButton();
    this.syncCardHandle();
    document.body.dataset.view = view;
    this.menu.setAttribute('aria-expanded', String(view === 'dock'));
    this.syncSearchExpanded();
    this.syncActiveChip();
    // Closing the dock resets the Flip screen to null.
    if (view !== 'dock') {
      this.flipDockScreen = null;
    }
    // Opening the dock always starts with the list screen.
    if (view === 'dock' && this.flipDockScreen === null) {
      this.flipDockScreen = 'list';
    }
    // Derive dock content (dock-main, footer) from current state.
    this.syncDockContent();
    this.syncMenuIcon();
    this.syncLocateClearance();
    this.onChange?.();
  }

  // On Flip, cycle the icon button through three screens:
  //   null (☰) → open dock showing categories + results (list screen)
  //   'list' (◇) → replace results with modes menu (modes screen)
  //   'modes' (×) → close dock and reset
  cycleFlipMenu() {
    switch (this.flipDockScreen) {
      case null:
        // Open the dock; setView transitions flipDockScreen to 'list' and shows the list.
        this.setView('dock');
        break;
      case 'list':
        // Show the modes menu (footer content) and hide results.
        this.flipDockScreen = 'modes';
        this.syncDockContent();
        break;
      case 'modes':
        // Closing the dock resets the screen to null.
        this.setView('closed');
        break;
    }
    this.syncMenuIcon();
  }

  // Derive the visible dock content from current state.
  // On Flip with the dock open: show the results list on the list screen, show the footer on the modes screen.
  // The categories row stays visible in both screens (it lives inside dock-main).
  // In every other case (dock closed, or not Flip): show both dock-main and footer, minus a covering keyboard.
  syncDockContent() {
    const isFlip = this.flipLayoutQuery.matches;
    const isDockOpen = this.view === 'dock';
    const showResults = !(isFlip && isDockOpen) || this.flipDockScreen === 'list';
    // On the modes screen, hide only the results section so categories remain visible.
    this.dockMain.hidden = false;
    document.getElementById('results').hidden = !showResults;
    this.footer.hidden = !isDockFooterVisible({
      isFlipLayout: isFlip,
      isDockOpen,
      flipDockScreen: this.flipDockScreen,
      isKeyboardOpen: this.keyboardOpen()
    });
  }

  // Update the menu button icon and accessible label for the current state.
  // On Flip, derive icon and label from view + flipDockScreen.
  syncMenuIcon() {
    const iconUse = this.menu.querySelector('use');
    if (this.flipLayoutQuery.matches) {
      if (this.view !== 'dock') {
        // Dock closed: ☰ Menu
        iconUse.setAttribute('href', '#i-menu');
        this.menu.setAttribute('aria-label', 'Open menu');
      } else if (this.flipDockScreen === 'list') {
        // Dock open, list shown: ◇ Modes
        iconUse.setAttribute('href', '#i-modes');
        this.menu.setAttribute('aria-label', 'Show map modes');
      } else {
        // Dock open, modes shown: × Close
        iconUse.setAttribute('href', '#i-close');
        this.menu.setAttribute('aria-label', 'Close menu');
      }
    } else {
      iconUse.setAttribute('href', '#i-menu');
      this.menu.setAttribute('aria-label', this.view === 'dock' ? 'Close menu' : 'Open menu');
    }
  }

  syncResultsVisibility() {
    const isSearching = this.view === 'search';
    const isFullscreen = this.card.dataset.state === 'fullscreen';
    this.bubble.hidden = !isSearching || this.areResultsMinimized || isFullscreen;
    this.strip.hidden = !isSearching || !this.areResultsMinimized || isFullscreen;
    if (!this.strip.hidden)
      document.getElementById('results-strip-label').textContent = this.resultsLabel?.() ?? '';
  }

  // On desktop, data-state makes the panel a floating chips row (empty) or a joined results card (open/filled).
  syncDesktopSearchUI() {
    if (this.mobileLayoutQuery.matches) {
      this.desktopSearchPanel.hidden = true;
      return;
    }
    this.desktopSearchPanel.hidden = this.view === 'dock';
    this.desktopSearchPanel.dataset.state = this.state;
    this.syncSearchExpanded();
  }

  // Keep aria-expanded on the search input in sync with whether results are visible.
  syncSearchExpanded() {
    this.search.setAttribute('aria-expanded', String(this.areResultsVisible()));
  }

  // Call after the card's content is in place and it is no longer hidden.
  placeCardOpened() {
    if (this.mobileLayoutQuery.matches && this.view === 'dock') this.setView('search');
    this.syncCardForLayout();
    this.syncLocateClearance();
  }

  resetCardState() {
    delete this.card.dataset.state;
    this.clearCardDragGeometry();
    this.card.style.removeProperty('touch-action');
    this.cardBody.inert = false;
    this.areResultsMinimized = false;
    this.syncMobileCardPresentation();
    this.syncResultsVisibility();
    this.syncActiveChip();
    this.syncLocateClearance();
  }

  // The floating desktop card only pushes Locate when it reaches the button's right-hand column.
  syncLocateClearance() {
    const cardBox = this.card.hidden ? null : this.card.getBoundingClientRect();
    const locateBox = document.getElementById('position-action').getBoundingClientRect();
    document.body.dataset.cardAtLocate = String(doesCardReachLocateColumn(cardBox, locateBox));
  }

  syncCardForLayout() {
    if (!this.mobileLayoutQuery.matches) {
      this.resetCardState();
      return;
    }
    this.setCardState(this.view === 'search' ? 'peek' : 'full', {notify: false});
  }

  // The phone card can step up from Peek and Full; the fullscreen handle steps back to Full.
  canStepCardUp() {
    const state = this.card.dataset.state;
    return state === 'peek' || (state === 'full' && this.isMobilePhone);
  }

  // Tapping the header or handle steps the phone card; fullscreen steps back to Full.
  activateCardHandle() {
    const state = this.card.dataset.state;
    if (this.isMobilePhone) {
      if (state === 'fullscreen') {
        this.setCardState('full');
        return;
      }
      const next = cardStateAfterSwipe({
        state,
        direction: 'up',
        resultsBehind: this.view === 'search'
      });
      if (next !== state) this.setCardState(next);
      return;
    }
    // Flip and other mobile layouts keep the earlier peek/full toggle above results.
    if (this.view === 'search' && state === 'peek') this.setCardState('full');
    else if (this.view === 'search' && state === 'full') this.setCardState('peek');
  }

  setCardState(state, {notify = true} = {}) {
    this.clearCardDragGeometry();
    this.card.dataset.state = state;
    // Clipped controls must not stay reachable by keyboard; fullscreen content is fully visible.
    this.cardBody.inert = state === 'peek';
    if (this.view === 'search') this.areResultsMinimized = state === 'full' || state === 'fullscreen';
    this.syncResultsVisibility();
    this.syncCardHandle();
    this.syncMobileCardPresentation();
    this.card.style.setProperty('--card-head', `${this.cardHeadBottom()}px`);
    this.card.style.setProperty('--card-peek', `${this.cardPeekHeight()}px`);
    this.syncCardTouch();
    this.syncActiveChip();
    if (notify) this.onViewport?.();
  }

  // Expose the phone card state so CSS can hide search, place the Locate button, and style fullscreen.
  syncMobileCardPresentation() {
    const state = !this.card.hidden && this.isMobilePhone ? this.card.dataset.state : '';
    if (state) document.body.dataset.mobileCardState = state;
    else delete document.body.dataset.mobileCardState;
    this.syncMobileCardOffset();
  }

  syncMobileCardOffset() {
    if (!this.isMobilePhone || this.card.hidden) {
      document.documentElement.style.removeProperty('--mobile-card-visible-height');
      return;
    }
    // --mobile-card-visible-height is the card height CSS reserves below the Locate button
    // (style.css lifts .position-control above the visible phone card in Peek and Full).
    const state = this.card.dataset.state;
    let visibleHeight = 0;
    if (state === 'peek') {
      visibleHeight = this.cardPeekHeight();
    } else if (state === 'full') {
      const renderedHeight = this.card.offsetHeight || this.cardRestingHeight();
      const restingHeight = this.cardRestingHeight();
      // The card can be mid-transition; never reserve more than its settled Full height.
      visibleHeight = Math.min(renderedHeight, restingHeight);
    }
    document.documentElement.style.setProperty('--mobile-card-visible-height', `${visibleHeight}px`);
  }

  // The handle stays available above results and, on phones, can step the card up or back from Fullscreen.
  syncCardHandle() {
    const state = this.card.dataset.state;
    const isExpanded = state === 'full' || state === 'fullscreen';
    const isHandleUsable = this.isMobilePhone || this.view === 'search';
    this.cardHandle.tabIndex = isHandleUsable ? 0 : -1;
    this.cardHandle.setAttribute('aria-hidden', String(!isHandleUsable));
    this.cardHandle.setAttribute('aria-expanded', String(isExpanded));
    if (this.isMobilePhone) {
      const label =
        state === 'peek' ? 'Show more' : state === 'full' ? 'Show full screen' : 'Show less';
      this.cardHandle.setAttribute('aria-label', label);
    } else {
      this.cardHandle.setAttribute('aria-label', isExpanded ? 'Show less' : 'Show full details');
    }
  }

  cardHeadBottom() {
    return this.cardHead.offsetTop + this.cardHead.offsetHeight;
  }

  cardPeekHeight() {
    return this.cardHeadBottom() + 2 * this.card.clientTop;
  }

  // The settled Full height depends on the content, not on the current (possibly dragged) inline height.
  cardFullHeight() {
    const borders = this.card.offsetHeight - this.card.clientHeight;
    const maximumHeightPixels = (window.visualViewport?.height ?? innerHeight) * 0.6;
    return Math.min(this.card.scrollHeight + borders, maximumHeightPixels);
  }

  // Only Fullscreen scrolls; a tall Full card keeps vertical touches for pulling the card.
  syncCardTouch() {
    const state = this.card.dataset.state;
    const isFullscreenScrollable =
      state === 'fullscreen' && this.card.scrollHeight > this.card.clientHeight + 1;
    if (isFullscreenScrollable) this.card.style.touchAction = 'pan-y';
    else this.card.style.removeProperty('touch-action');
    this.syncMobileCardOffset();
  }

  // Full clips its body, so focus must never land on content the person cannot see.
  revealFocusedCardContent(target) {
    if (!this.isMobilePhone || this.card.dataset.state !== 'full' || !this.cardBody.contains(target)) return;
    const cardBox = this.card.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    if (targetBox.bottom <= cardBox.bottom + 1 && targetBox.top >= cardBox.top - 1) return;
    this.setCardState('fullscreen');
    this.scrollCardTargetIntoView(target);
  }

  // The state change animates the scroll container; reveal the target once it has its final size.
  scrollCardTargetIntoView(target) {
    const reveal = () => target.scrollIntoView({block: 'nearest'});
    const animations = this.card.getAnimations();
    if (!animations.length) {
      reveal();
      return;
    }
    Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (target.isConnected) reveal();
    });
  }

  // The card's height once its transition settles, so the camera aims for the final layout.
  cardRestingHeight() {
    const state = this.card.dataset.state;
    if (state === 'peek') return this.cardPeekHeight();
    if (state === 'fullscreen') return window.visualViewport?.height ?? innerHeight;
    return this.cardFullHeight();
  }

  // The resting bottom gap is CSS geometry, not the current card edge: a fullscreen card reaches the screen bottom.
  cardRestingBottomInset() {
    const keyboardInset = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset')
    );
    return (Number.isFinite(keyboardInset) ? keyboardInset : 0) + PHONE_CARD_BOTTOM_GAP_PIXELS;
  }

  // Every phone drag uses the same step rectangles, measured in the map container's coordinates.
  phoneCardSteps() {
    const containerRect = this.card.parentElement.getBoundingClientRect();
    return phoneCardSteps({
      viewportHeight: containerRect.height,
      bottomInset: this.cardRestingBottomInset(),
      peekHeight: this.cardPeekHeight(),
      fullHeight: this.cardFullHeight()
    });
  }

  applyCardDragFrame(frame) {
    const style = this.card.style;
    style.top = `${frame.rect.top}px`;
    style.height = `${frame.rect.height}px`;
    // A resting step can have a smaller max-height than the frame; the finger owns the size during the drag.
    style.maxHeight = 'none';
    style.bottom = 'auto';
    style.left = `${frame.rect.inset}px`;
    style.right = `${frame.rect.inset}px`;
  }

  // Pixel geometry lets the browser animate the settle; auto and none cannot be transitioned.
  // Keep max-height unbounded until cleanup, or a Full/peek cap would clamp the animating height immediately.
  applyCardStepGeometry(step) {
    const style = this.card.style;
    style.top = `${step.top}px`;
    style.height = `${step.height}px`;
    style.maxHeight = 'none';
    style.bottom = `${step.bottom}px`;
    style.left = `${step.inset}px`;
    style.right = `${step.inset}px`;
  }

  clearCardDragGeometry() {
    for (const property of ['top', 'height', 'max-height', 'bottom', 'left', 'right'])
      this.card.style.removeProperty(property);
  }

  swipeCard(direction) {
    const state = this.card.dataset.state;
    const next = this.isMobilePhone
      ? cardStateAfterSwipe({
          state,
          direction,
          resultsBehind: this.view === 'search'
        })
      : cardStateAfterSwipeWithoutFullscreen({
          state,
          direction,
          resultsBehind: this.view === 'search'
        });
    if (next === state) return;
    if (next === 'closed') this.onCardSwipedAway?.();
    else this.setCardState(next);
  }

  wireCardGestures() {
    this.wirePointerCardGestures();
    this.wireTouchCardGestures();
    this.wireCardWheel();
  }

  // Pointer events keep Flip and non-touch drags; phone touches use a continuous rectangle.
  wirePointerCardGestures() {
    let pointerDrag = null;
    this.card.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'touch' && this.isMobilePhone) return;
      if (!this.mobileLayoutQuery.matches || event.button || event.target.closest('a, .point-actions'))
        return;
      const isOnCardHeader = !!event.target.closest('#card-handle, #place-head');
      if (!isOnCardHeader && this.card.scrollTop > 0) return;
      pointerDrag = {
        id: event.pointerId,
        startYPixels: event.clientY,
        startHeightPixels: this.card.offsetHeight,
        hasMoved: false
      };
    });
    this.card.addEventListener('pointermove', (event) => {
      if (event.pointerId !== pointerDrag?.id) return;
      const deltaYPixels = event.clientY - pointerDrag.startYPixels;
      if (!pointerDrag.hasMoved && Math.abs(deltaYPixels) < DRAG_START_PIXELS) return;
      if (!pointerDrag.hasMoved) {
        // Capturing only now leaves a plain tap to reach the handle as a normal click.
        pointerDrag.hasMoved = true;
        this.card.setPointerCapture(event.pointerId);
        this.card.classList.add('dragging');
      }
      const draggedHeightPixels = pointerDrag.startHeightPixels - deltaYPixels;
      const minimumHeightPixels = Math.min(this.cardPeekHeight(), pointerDrag.startHeightPixels);
      this.card.style.maxHeight = `${Math.max(minimumHeightPixels, draggedHeightPixels)}px`;
      this.card.style.transform =
        draggedHeightPixels < minimumHeightPixels
          ? `translateY(${minimumHeightPixels - draggedHeightPixels}px)`
          : '';
    });
    const finish = event => {
      if (event.pointerId !== pointerDrag?.id) return;
      const {hasMoved, startYPixels} = pointerDrag;
      pointerDrag = null;
      if (!hasMoved) return;
      this.card.classList.remove('dragging');
      this.card.style.removeProperty('max-height');
      this.card.style.removeProperty('transform');
      if (event.type === 'pointercancel') return;
      const deltaYPixels = event.clientY - startYPixels;
      if (deltaYPixels > FLIP_SWIPE_THRESHOLD_PIXELS) this.swipeCard('down');
      else if (deltaYPixels < -FLIP_SWIPE_THRESHOLD_PIXELS && this.canStepCardUp()) this.swipeCard('up');
    };
    this.card.addEventListener('pointerup', finish);
    this.card.addEventListener('pointercancel', finish);
  }

  wireTouchCardGestures() {
    let phoneDrag = null;
    const cancel = () => {
      if (!phoneDrag) return;
      phoneDrag = null;
      this.card.classList.remove('dragging');
      this.clearCardDragGeometry();
    };
    this.card.addEventListener('touchstart', (event) => {
      if (!this.isMobilePhone || this.card.hidden || event.touches.length !== 1) {
        cancel();
        return;
      }
      const touch = event.touches[0];
      if (!touch.target.closest('a, .point-actions')) phoneDrag = this.newPhoneCardDrag(touch, event.timeStamp);
    }, {passive: true});
    this.card.addEventListener('touchmove', (event) => {
      const touch = this.matchingTouch(event.touches, phoneDrag?.identifier);
      if (!touch) return;
      const wasMoving = phoneDrag.hasMoved;
      if (!this.advancePhoneCardDrag(phoneDrag, touch)) return;
      event.preventDefault();
      phoneDrag.lastYPixels = touch.clientY;
      this.recordCardVelocitySample(phoneDrag, touch.clientY, event.timeStamp, wasMoving);
      const frame = cardDragFrame({
        state: phoneDrag.state,
        deltaYPixels: touch.clientY - phoneDrag.pullStartYPixels,
        resultsBehind: phoneDrag.resultsBehind,
        steps: phoneDrag.steps
      });
      if (frame) {
        phoneDrag.lastFrame = frame;
        this.applyCardDragFrame(frame);
      }
    }, {passive: false});
    const finish = event => {
      const touch = this.matchingTouch(event.changedTouches, phoneDrag?.identifier);
      const drag = phoneDrag;
      cancel();
      if (drag) this.settlePhoneCardDrag(drag, touch, event.type === 'touchcancel');
    };
    this.card.addEventListener('touchend', finish);
    this.card.addEventListener('touchcancel', finish);
  }

  matchingTouch(touchList, identifier) {
    return identifier === undefined
      ? null
      : Array.from(touchList).find(candidate => candidate.identifier === identifier);
  }

  newPhoneCardDrag(touch, timeMilliseconds) {
    return {
      identifier: touch.identifier,
      state: this.card.dataset.state,
      resultsBehind: this.view === 'search',
      steps: this.phoneCardSteps(),
      hasMoved: false,
      startYPixels: touch.clientY,
      lastYPixels: touch.clientY,
      pullStartYPixels: touch.clientY,
      samples: [{y: touch.clientY, time: timeMilliseconds}]
    };
  }

  recordCardVelocitySample(drag, yPixels, timeMilliseconds, wasMoving) {
    // Scrolling in Fullscreen is not part of the pull; its velocity must not carry into the settle.
    if (!wasMoving && drag.state === 'fullscreen') drag.samples = [];
    drag.samples.push({y: yPixels, time: timeMilliseconds});
    while (
      drag.samples.length > 2 &&
      timeMilliseconds - drag.samples[0].time > FLICK_VELOCITY_WINDOW_MILLISECONDS
    )
      drag.samples.shift();
  }

  // Fullscreen owns vertical touches until its content is back at the top; then a downward pull moves the card.
  advancePhoneCardDrag(drag, touch) {
    if (drag.hasMoved) return true;
    const deltaYPixels = touch.clientY - drag.startYPixels;
    if (drag.state === 'fullscreen' && (this.card.scrollTop > 0 || deltaYPixels <= 0)) return false;
    if (Math.abs(deltaYPixels) < DRAG_START_PIXELS) return false;
    drag.hasMoved = true;
    this.cardSettleToken = (this.cardSettleToken ?? 0) + 1;
    drag.pullStartYPixels = touch.clientY;
    this.card.classList.add('dragging');
    return true;
  }

  settlePhoneCardDrag(drag, touch, isCancelled) {
    if (!drag.hasMoved) return;
    const lastYPixels = touch?.clientY ?? drag.lastYPixels;
    const deltaYPixels = lastYPixels - drag.pullStartYPixels;
    const nextState = isCancelled
      ? drag.state
      : cardStateAfterDrag({
          state: drag.state,
          deltaYPixels,
          velocityPixelsPerMillisecond: touchVelocityPixelsPerMillisecond(drag.samples),
          resultsBehind: drag.resultsBehind,
          steps: drag.steps
        });
    this.card.classList.remove('dragging');
    if (nextState === 'closed') {
      this.onCardSwipedAway?.();
      return;
    }
    this.setCardState(nextState);
    if (isCancelled) return;
    const fromFrame = drag.lastFrame;
    if (fromFrame) this.settleCardGeometry(fromFrame, drag.steps[nextState], nextState);
  }

  settleCardGeometry(fromFrame, targetStep, targetState) {
    const token = (this.cardSettleToken ?? 0) + 1;
    this.cardSettleToken = token;
    // setCardState reads layout with CSS geometry; restore the dragged rectangle and resolve it before moving on.
    this.applyCardDragFrame(fromFrame);
    this.card.getBoundingClientRect();
    this.applyCardStepGeometry(targetStep);
    const animations = this.card.getAnimations();
    if (!animations.length) {
      this.clearCardDragGeometry();
      return;
    }
    Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (this.cardSettleToken === token && this.card.dataset.state === targetState)
        this.clearCardDragGeometry();
    });
  }

  wireCardWheel() {
    let wheelGestureEndsMilliseconds = 0;
    this.card.addEventListener(
      'wheel',
      event => {
        if (!this.mobileLayoutQuery.matches) return;
        const isSteppingUp = event.deltaY > 0 && this.canStepCardUp();
        const isSwipingDown = event.deltaY < 0 && this.card.scrollTop === 0;
        if (!isSteppingUp && !isSwipingDown) return;
        event.preventDefault();
        if (performance.now() < wheelGestureEndsMilliseconds) return;
        wheelGestureEndsMilliseconds = performance.now() + WHEEL_GESTURE_MILLISECONDS;
        this.swipeCard(isSteppingUp ? 'up' : 'down');
      },
      {passive: false}
    );
  }

  // The phone category strip has no scrollbar, so a mouse wheel scrolls it sideways.
  wireCategoryWheel() {
    const strip = document.getElementById('categories');
    strip.addEventListener(
      'wheel',
      (event) => {
        if (!this.mobileLayoutQuery.matches || !event.deltaY || event.deltaX) return;
        event.preventDefault();
        strip.scrollLeft += event.deltaY;
      },
      {passive: false}
    );
  }

  restoreFocus(element) {
    this.isRestoringFocus = true;
    element?.focus({preventScroll: true});
    this.isRestoringFocus = false;
  }

  close(shouldRestoreFocus = false) {
    this.setView('closed');
    if (shouldRestoreFocus) this.restoreFocus(this.trigger);
  }

  // Clear the search query and update the UI.
  clearQuery() {
    this.search.value = '';
    this.syncClearButton();
    this.syncDesktopSearchUI();
    this.syncSearchExpanded();
    this.onResultsRefreshed?.();
  }

  // Returns true when the desktop results panel is visible and shows results.
  #isDesktopResultsPanelVisible() {
    return !this.mobileLayoutQuery.matches &&
      !this.desktopSearchPanel.hidden &&
      this.desktopSearchPanel.dataset.state !== 'empty';
  }

  // Returns true when the results list is visible to the user.
  areResultsVisible() {
    if (this.view === 'search' || this.view === 'dock') return true;
    // On desktop, focusing search or a query shows results in the panel even with the dock closed.
    return !this.mobileLayoutQuery.matches && (this.isResultsPanelOpen || this.hasQuery());
  }

  keyboardOpen() {
    const viewport = window.visualViewport;
    // A pinch-zoomed page also shrinks the visual viewport, without any keyboard.
    if (!this.mobileLayoutQuery.matches || (viewport?.scale ?? 1) > 1.01) return false;
    const visibleHeight = viewport?.height ?? innerHeight;
    return innerHeight - visibleHeight > MINIMUM_KEYBOARD_HEIGHT_PIXELS;
  }

  syncViewport(notify = true) {
    const viewport = window.visualViewport;
    const height = viewport?.height ?? innerHeight;
    const top = viewport?.offsetTop ?? 0;
    const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-inset'));
    const barHeight = document.querySelector('.search-bar').getBoundingClientRect().height;
    const bounds = searchBounds({height, top, inset, barHeight});
    const style = document.documentElement.style;
    style.setProperty('--visible-height', `${height}px`);
    style.setProperty('--visible-top', `${top}px`);
    // CSS 100dvh and visualViewport can disagree on screens with camera cut-outs, which left an empty band under the
    // dock, so the keyboard inset comes from one source: the layout viewport less the visible part.
    style.setProperty('--keyboard-inset', `${Math.max(0, innerHeight - height - top)}px`);
    style.setProperty('--search-top', `${bounds.top}px`);
    style.setProperty('--search-max-height', `${bounds.maxHeight}px`);
    // A viewport event must not overrule the Flip screen's own footer rule. Re-derive the whole dock content,
    // which also hides the footer here when a keyboard would cover it outside Flip.
    this.syncDockContent();
    this.syncLocateClearance();
    if (notify) this.onViewport?.();
  }

  mapGeometry() {
    const map = document.getElementById('map').getBoundingClientRect();
    const header = document.querySelector('.search-bar').getBoundingClientRect();
    const card = document.getElementById('place-card');
    const route = document.getElementById('route-endpoints');
    const viewport = window.visualViewport;
    const details = card.hidden ? null : card.getBoundingClientRect();
    const isPhoneCard = !!details && this.mobileLayoutQuery.matches;
    const isFullscreenCard = this.card.dataset.state === 'fullscreen';
    const detailsTop = isPhoneCard ? details.bottom - this.cardRestingHeight() : details?.top;
    const cardBox = details && {
      left: details.left - map.left,
      right: details.right - map.left,
      top: detailsTop - map.top,
      bottom: details.bottom - map.top
    };
    const searchPanel = this.areResultsMinimized ? this.strip : this.bubble;
    const isSearchUiVisible = this.view === 'search' && !isFullscreenCard;
    return {
      width: map.width,
      height: map.height,
      visibleTop: Math.max(0, (viewport?.offsetTop ?? 0) - map.top),
      visibleHeight: viewport?.height ?? innerHeight,
      headerBottom: isFullscreenCard ? 0 : header.bottom - map.top,
      searchBottom: isSearchUiVisible ? searchPanel.getBoundingClientRect().bottom - map.top : 0,
      dockRight:
        !isFullscreenCard && (this.view === 'dock' || this.#isDesktopResultsPanelVisible())
          ? document.querySelector('.sidebar').getBoundingClientRect().right - map.left
          : 0,
      details: isFullscreenCard ? null : cardBox,
      coversBottom: isPhoneCard,
      routeBottom: route.hidden || isFullscreenCard ? 0 : route.getBoundingClientRect().bottom - map.top,
      mobile: this.mobileLayoutQuery.matches
    };
  }

  mapOffset() {
    return uncoveredMapOffset(this.mapGeometry());
  }

  mapArea() {
    return uncoveredMapArea(this.mapGeometry());
  }
}
