import {FLIP_MEDIA_QUERY} from './device-class.js';
import {depthOf, historyMarker, openSteps, stateAfterBack} from './history-steps.js';

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

// All geometry is in CSS pixels in the map container, including the keyboard's visible viewport.
export function searchBounds({height, top = 0, inset = 12, barHeight = 54}) {
  // Header, fixed categories, and results occupy the upper half of the unobscured screen.
  // 16 px is the space between the bar and the panel below it.
  const gapBelowBar = 16;
  const headerBottom = inset + barHeight + gapBelowBar;
  return {top: top + headerBottom, maxHeight: Math.max(0, height / 2 - headerBottom)};
}

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
  routeBottom = 0
}) {
  let left = Math.max(16, dockRight ? dockRight + 16 : 0);
  const right = width - 72;
  let top = Math.max(visibleTop + 16, headerBottom + 16, searchBottom + 16, routeBottom + 16);
  let bottom = Math.min(height - 20, visibleTop + visibleHeight - 20);
  // Every details card covers the bottom of the map, on the phone and on the desktop alike.
  if (details) bottom = Math.min(bottom, details.top - 16);
  left = Math.min(left, Math.max(16, right - 40));
  top = Math.min(top, Math.max(visibleTop + 16, bottom - 40));
  return {left, right, top, bottom};
}

export function uncoveredMapOffset(geometry) {
  const {left, right, top, bottom} = uncoveredMapArea(geometry);
  return [(left + right) / 2 - geometry.width / 2, (top + bottom) / 2 - geometry.height / 2];
}

// A chosen place inside this share of the uncovered map's width and height needs no camera move.
export const FOCUS_ZONE_RATIO = 0.75;

export function isInFocusZone({x, y}, {left, right, top, bottom}) {
  const insetX = ((right - left) * (1 - FOCUS_ZONE_RATIO)) / 2;
  const insetY = ((bottom - top) * (1 - FOCUS_ZONE_RATIO)) / 2;
  return x >= left + insetX && x <= right - insetX && y >= top + insetY && y <= bottom - insetY;
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
  constructor({onSearch, onResultsRefreshed, onChange, onViewport, onCardSwipedAway, onResultsClosed, resultsLabel}) {
    Object.assign(this, {
      onSearch,
      onResultsRefreshed,
      onChange,
      onViewport,
      onCardSwipedAway,
      onResultsClosed,
      resultsLabel
    });
    this.initQueries();
    this.initState();
    this.installHistory();
    this.wireInterfaceEvents();
    this.syncPanelPosition();
    this.syncDesktopSearchUI();
    this.syncViewport(false);
  }

  initQueries() {
    this.mobileLayoutQuery = matchMedia('(max-width: 720px)');
    this.flipLayoutQuery = matchMedia(FLIP_MEDIA_QUERY);
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
    this.desktopSearchPanel = document.getElementById('desktop-search-panel');
    this.footer = document.querySelector('.dock-footer');
  }

  initState() {
    this.view = 'closed';
    this.isResultsPanelOpen = false;
    this.areResultsMinimized = false;
    this.trigger = this.menu;
    this.isRestoringFocus = false;
    this.flipDockScreen = null; // 'list' | 'modes' | null
    this.isResultsCompacted = false;
    this.cardFromDock = false;
    this.isApplyingHistory = false;
    this.pendingHistoryBacks = 0;
    this.queuedReconcile = false;
  }

  get isMobilePhone() {
    return this.mobileLayoutQuery.matches && !this.flipLayoutQuery.matches;
  }

  get isFlip() {
    return this.flipLayoutQuery.matches;
  }

  wireInterfaceEvents() {
    this.menu.addEventListener('click', () => this.activateMenu());
    this.clearButton.addEventListener('click', () => this.clearQueryOrCloseResults());
    this.strip.addEventListener('click', () => {
      if (this.isResultsCompacted && this.card.hidden) {
        this.restoreSearchBubble();
        return;
      }
      this.setCardState('peek');
    });
    this.cardHandle.addEventListener('click', () => this.activateCardHandle());
    this.card.addEventListener('focusin', event => this.revealFocusedCardContent(event.target));
    this.cardHead.addEventListener('click', event => {
      if (!this.isMobilePhone || event.target.closest('button, a')) return;
      this.activateCardHandle();
    });
    this.wireSearchEvents();
    this.mobileLayoutQuery.addEventListener('change', () => this.handleMobileLayoutChange());
    this.flipLayoutQuery.addEventListener('change', () => this.handleFlipLayoutChange());
    window.visualViewport?.addEventListener('resize', () => this.syncViewport());
    window.visualViewport?.addEventListener('scroll', () => this.syncViewport());
    window.addEventListener('resize', () => this.syncViewport());
    this.observer = new ResizeObserver(() => {
      this.syncCardTouch();
      this.onViewport?.();
    });
    this.observer.observe(this.bubble);
    this.observer.observe(this.card);
    this.wireCardGestures();
    this.wireCategoryWheel();
  }

  wireSearchEvents() {
    for (const type of ['focus', 'click']) {
      this.search.addEventListener(type, () => {
        if (this.isRestoringFocus) return;
        if (this.flipLayoutQuery.matches && this.flipDockScreen === 'modes') {
          this.showFlipList();
          this.onSearch?.();
          return;
        }
        this.openSearch();
      });
    }
    this.search.addEventListener('input', () => {
      if (this.flipLayoutQuery.matches && this.flipDockScreen === 'modes') this.showFlipList();
      this.syncClearButton();
      this.syncDesktopSearchUI();
    });
  }

  handleMobileLayoutChange() {
    if (this.view === 'search' && !this.mobileLayoutQuery.matches) this.setView('dock');
    if (!this.card.hidden) this.syncCardForLayout();
    else this.syncMobileCardPresentation();
    this.syncPanelPosition();
    this.syncDesktopSearchUI();
    this.syncViewport();
    this.reconcile();
  }

  handleFlipLayoutChange() {
    this.syncClearButton();
    this.syncDockContent();
    this.syncMenuIcon();
    if (!this.card.hidden) this.syncCardForLayout();
    else this.syncMobileCardPresentation();
    this.reconcile();
  }

  // --- History reconciler ---

  installHistory() {
    if (!this.canUseHistory()) return;
    const initialDepth = depthOf(history.state) ?? 0;
    history.replaceState(historyMarker(0), '');
    window.addEventListener('popstate', event => this.handlePopstate(event));
    if (initialDepth > 0) {
      this.pendingHistoryBacks = 1;
      history.go(-initialDepth);
    }
  }

  canUseHistory() {
    return typeof history !== 'undefined' && typeof history.pushState === 'function';
  }

  currentHistoryDepth() {
    return depthOf(history.state) ?? 0;
  }

  currentUIState() {
    const cardState = !this.card.hidden ? this.card.dataset.state || null : null;
    return {
      view: this.view,
      flipDockScreen: this.view === 'dock' ? this.flipDockScreen : null,
      resultsCompacted: !!this.isResultsCompacted && this.view === 'search' && this.card.hidden,
      card: cardState ? {state: cardState, fromDock: !!this.cardFromDock} : null
    };
  }

  desiredDepth() {
    return openSteps(this.currentUIState()).length;
  }

  reconcile() {
    if (!this.canUseHistory()) return;
    if (this.pendingHistoryBacks > 0) {
      this.queuedReconcile = true;
      return;
    }
    const desired = this.desiredDepth();
    const current = this.currentHistoryDepth();
    if (desired === current) {
      if (!this.isApplyingHistory) history.replaceState(historyMarker(desired), '');
      return;
    }
    if (desired > current) {
      if (this.isApplyingHistory) return;
      for (let depth = current + 1; depth <= desired; depth += 1) {
        history.pushState(historyMarker(depth), '');
      }
      return;
    }
    this.pendingHistoryBacks = 1;
    history.go(desired - current);
  }

  handlePopstate(event) {
    if (this.pendingHistoryBacks > 0) {
      this.pendingHistoryBacks -= 1;
      this.queuedReconcile = false;
      this.reconcile();
      return;
    }
    const targetDepth = depthOf(event.state);
    if (targetDepth === null) {
      if (this.desiredDepth() > 0) this.stepBackToDepth(0);
      this.reconcile();
      return;
    }
    if (this.desiredDepth() <= targetDepth) {
      this.reconcile();
      return;
    }
    this.isApplyingHistory = true;
    try {
      this.stepBackToDepth(targetDepth);
    } finally {
      this.isApplyingHistory = false;
    }
    this.reconcile();
  }

  stepBackToDepth(targetDepth) {
    let guard = 0;
    while (this.desiredDepth() > targetDepth && guard < 20) {
      this.stepBackOnce();
      guard += 1;
    }
  }

  stepBackOnce() {
    const current = this.currentUIState();
    const steps = openSteps(current);
    const top = steps[steps.length - 1];
    const target = stateAfterBack(current);
    this.applyBackStep(top, current, target);
  }

  applyBackStep(top, current, target) {
    if (!top) {
      this.goToOpeningView();
      return;
    }
    switch (top) {
      case 'search-bubble':
      case 'dock':
        this.goToOpeningView();
        return;
      case 'search-strip':
        this.restoreSearchBubble();
        return;
      case 'flip-modes':
        this.showFlipList();
        return;
      case 'card-fullscreen':
      case 'card-full':
        if (target.card) {
          this.setCardState(target.card.state);
        } else {
          this.closeCardByBack(current);
        }
        return;
      case 'card-peek':
        this.closeCardByBack(current);
        return;
      default:
        this.goToOpeningView();
    }
  }

  closeCardByBack(currentState) {
    const fromDock = !!currentState.card?.fromDock;
    this.cardFromDock = fromDock;
    this.onCardSwipedAway?.();
    // Closing a Flip card opened from the dock returns to the dock list.
    if (fromDock && this.flipLayoutQuery.matches) {
      this.isResultsCompacted = false;
      this.areResultsMinimized = false;
      this.setView('dock');
    }
  }

  goToOpeningView() {
    this.isResultsCompacted = false;
    this.areResultsMinimized = false;
    this.flipDockScreen = null;
    this.cardFromDock = false;
    if (!this.card.hidden) {
      this.onCardSwipedAway?.();
      return;
    }
    if (this.view !== 'closed') this.setView('closed');
    else this.reconcile();
  }


  // --- UI methods (normal, reconciler-synced) ---

  openSearch() {
    this.trigger = this.search;
    if (this.mobileLayoutQuery.matches) {
      const hasViewChanged = this.view !== 'dock' && this.view !== 'search';
      if (this.view !== 'dock') this.setView('search');
      if (hasViewChanged) this.onSearch?.();
      else if (this.areResultsMinimized) {
        if (this.isResultsCompacted && this.card.hidden) this.restoreSearchBubble();
        else this.setCardState('peek');
      } else if (this.isResultsCompacted && this.card.hidden) {
        this.restoreSearchBubble();
      } else {
        this.reconcile();
      }
      return;
    }
    const wasOpen = this.areResultsVisible();
    this.showResults();
    // Desktop: focusing reveals the joined results panel even with no query. The dock's state stays as it was.
    this.syncDesktopSearchUI();
    this.syncClearButton();
    this.syncSearchExpanded();
    // Refreshing results is not a new search: a card chosen on the map must stay open.
    if (!wasOpen) this.onResultsRefreshed?.();
    this.reconcile();
  }

  showResults() {
    this.isResultsPanelOpen = true;
    this.syncDesktopSearchUI();
    this.syncClearButton();
  }

  closeResults() {
    this.onResultsClosed?.();
    this.isResultsPanelOpen = false;
    this.trigger = this.menu;
    this.isResultsCompacted = false;
    this.areResultsMinimized = false;
    this.close(true);
  }

  close(shouldRestoreFocus = false) {
    this.isResultsCompacted = false;
    this.areResultsMinimized = false;
    this.flipDockScreen = null;
    this.cardFromDock = false;
    this.setView('closed');
    if (shouldRestoreFocus) this.restoreFocus(this.trigger);
  }

  setView(view) {
    const previousView = this.view;
    const wasClosed = previousView === 'closed';
    // Capture before hiding a container, which would clamp the hidden row's scroll position to zero.
    const categoryScrollLeft = document.getElementById('categories').scrollLeft;
    this.view = view;
    // Closing a dock or bubble is a return to the map; a desktop focus refresh with the same view is not.
    if (view === 'closed' && !wasClosed) this.isResultsPanelOpen = false;
    if (view !== 'search') {
      this.isResultsCompacted = false;
      this.areResultsMinimized = false;
      // A peek only makes sense above open results.
      if (this.card.dataset.state === 'peek' && !this.card.hidden) this.setCardState('full', {notify: false, skipReconcile: true});
    } else if (view === 'search' && previousView !== 'search') {
      this.isResultsCompacted = false;
    }
    if (view !== 'dock') this.flipDockScreen = null;
    if (view === 'dock' && this.flipDockScreen === null) this.flipDockScreen = 'list';

    this.dock.hidden = view !== 'dock';
    this.syncResultsVisibility();
    this.syncDesktopSearchUI();
    this.movePanelTo(this.#panelTargetFor(view), categoryScrollLeft);
    this.syncClearButton();
    this.syncCardHandle();
    document.body.dataset.view = view;
    this.menu.setAttribute('aria-expanded', String(view === 'dock'));
    this.syncSearchExpanded();
    this.syncDockContent();
    this.syncMenuIcon();
    this.onChange?.();
    this.reconcile();
  }

  #panelTargetFor(view) {
    if (view === 'search') return this.bubble;
    if (!this.mobileLayoutQuery.matches && view === 'closed') return this.desktopSearchPanel;
    return this.dockMain;
  }

  activateMenu() {
    this.trigger = this.menu;
    if (this.mobileLayoutQuery.matches) this.search.blur();
    if (this.flipLayoutQuery.matches) {
      this.cycleFlipMenu();
    } else if (this.view === 'dock') {
      this.setView('closed');
    } else {
      this.setView('dock');
    }
    this.onViewport?.();
  }

  cycleFlipMenu() {
    switch (this.flipDockScreen) {
      case null:
        this.setView('dock');
        break;
      case 'list':
        this.flipDockScreen = 'modes';
        this.syncDockContent();
        this.syncMenuIcon();
        this.reconcile();
        break;
      case 'modes':
        this.flipDockScreen = null;
        this.setView('closed');
        break;
      default:
        this.setView('dock');
        break;
    }
  }

  showFlipList() {
    if (this.flipDockScreen !== 'modes') return;
    this.flipDockScreen = 'list';
    this.syncDockContent();
    this.syncMenuIcon();
    this.reconcile();
  }

  syncDockContent() {
    const isFlip = this.flipLayoutQuery.matches;
    const isDockOpen = this.view === 'dock';
    if (isFlip && isDockOpen) {
      const showResults = this.flipDockScreen === 'list';
      const showFooter = this.flipDockScreen === 'modes';
      this.dockMain.hidden = false;
      document.getElementById('results').hidden = !showResults;
      this.footer.hidden = !showFooter;
    } else {
      this.dockMain.hidden = false;
      document.getElementById('results').hidden = false;
      this.footer.hidden = false;
    }
  }

  syncMenuIcon() {
    const iconUse = this.menu.querySelector('use');
    if (this.flipLayoutQuery.matches) {
      if (this.view !== 'dock') {
        iconUse.setAttribute('href', '#i-menu');
        this.menu.setAttribute('aria-label', 'Open menu');
      } else if (this.flipDockScreen === 'list') {
        iconUse.setAttribute('href', '#i-modes');
        this.menu.setAttribute('aria-label', 'Show map modes');
      } else {
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
    if (!this.strip.hidden) {
      document.getElementById('results-strip-label').textContent = this.resultsLabel?.() ?? '';
    }
  }

  syncDesktopSearchUI() {
    if (this.mobileLayoutQuery.matches) {
      this.desktopSearchPanel.hidden = true;
      return;
    }
    this.desktopSearchPanel.hidden = this.view === 'dock';
    this.desktopSearchPanel.dataset.state = this.state;
    this.syncSearchExpanded();
  }

  syncSearchExpanded() {
    this.search.setAttribute('aria-expanded', String(this.areResultsVisible()));
  }

  get state() {
    return searchBarState({hasQuery: this.hasQuery(), resultsVisible: this.areResultsVisible()});
  }

  hasQuery() {
    return this.search.value.trim().length > 0;
  }

  areResultsVisible() {
    if (this.view === 'search' || this.view === 'dock') return true;
    return !this.mobileLayoutQuery.matches && (this.isResultsPanelOpen || this.hasQuery());
  }

  syncClearButton() {
    const isVisible = isClearButtonVisible({
      state: this.state,
      isFlipLayout: this.flipLayoutQuery.matches
    });
    this.clearButton.dataset.clearVisible = String(isVisible);
    this.clearButton.setAttribute('aria-hidden', String(!isVisible));
    this.clearButton.tabIndex = isVisible ? 0 : -1;
  }

  clearQueryOrCloseResults() {
    if (this.state === 'filled') {
      this.clearQuery();
      this.restoreFocus(this.search);
      return;
    }
    if (this.flipLayoutQuery.matches) return;
    this.closeResults();
  }

  clearQuery() {
    this.search.value = '';
    this.syncClearButton();
    this.syncDesktopSearchUI();
    this.syncSearchExpanded();
    this.onResultsRefreshed?.();
  }

  handleEmptyMapTap() {
    if (!this.mobileLayoutQuery.matches) return false;
    if (this.view !== 'search') return false;
    if (this.isResultsCompacted || this.areResultsMinimized) return false;
    if (!this.card.hidden) return false;
    this.isResultsCompacted = true;
    this.areResultsMinimized = true;
    this.syncResultsVisibility();
    this.reconcile();
    return true;
  }

  restoreSearchBubble() {
    if (!this.isResultsCompacted) return false;
    this.isResultsCompacted = false;
    this.areResultsMinimized = false;
    this.syncResultsVisibility();
    this.reconcile();
    return true;
  }


  syncPanelPosition() {
    this.movePanelTo(this.#panelTargetFor(this.view));
  }

  movePanelTo(target, scrollLeft = document.getElementById('categories').scrollLeft) {
    const categories = document.getElementById('categories');
    if (this.panel.parentElement !== target) target.append(this.panel);
    categories.scrollLeft = scrollLeft;
  }

  placeCardOpened({fromDock = false} = {}) {
    this.cardFromDock = !!(fromDock && this.isFlip);
    if (this.mobileLayoutQuery.matches && this.view === 'dock') {
      // A card chosen from the dock is presented in the search view.
      this.setView('search');
    }
    this.syncCardForLayout();
  }

  syncCardForLayout() {
    if (!this.mobileLayoutQuery.matches) {
      this.resetCardState();
      return;
    }
    const initialState = this.view === 'search' ? 'peek' : 'full';
    this.setCardState(initialState, {notify: false});
  }

  setCardState(state, {notify = true, skipReconcile = false} = {}) {
    if (state === 'closed') {
      this.onCardSwipedAway?.();
      return;
    }
    this.clearCardDragGeometry();
    this.card.dataset.state = state;
    this.cardBody.inert = state === 'peek';
    if (this.view === 'search') {
      this.areResultsMinimized = state === 'full' || state === 'fullscreen';
      if (state === 'peek') this.areResultsMinimized = this.isResultsCompacted;
      if (state !== 'peek') this.isResultsCompacted = false;
    } else {
      this.isResultsMinimized = false;
      if (!this.isResultsCompacted) this.isResultsCompacted = false;
    }
    this.syncResultsVisibility();
    this.syncCardHandle();
    this.syncMobileCardPresentation();
    this.card.style.setProperty('--card-head', `${this.cardHeadBottom()}px`);
    this.card.style.setProperty('--card-peek', `${this.cardPeekHeight()}px`);
    this.syncCardTouch();
    if (notify) this.onViewport?.();
    if (!skipReconcile) this.reconcile();
  }

  resetCardState() {
    const restoreDock = !!(this.cardFromDock && this.isFlip);
    delete this.card.dataset.state;
    this.clearCardDragGeometry();
    this.card.style.removeProperty('touch-action');
    this.cardBody.inert = false;
    this.cardFromDock = false;
    this.areResultsMinimized = this.isResultsCompacted && this.view === 'search';
    if (this.view !== 'search') this.isResultsCompacted = false;
    this.syncMobileCardPresentation();
    this.syncResultsVisibility();
    if (restoreDock) this.setView('dock');
    else this.reconcile();
  }

  canStepCardUp() {
    const state = this.card.dataset.state;
    return state === 'peek' || (state === 'full' && this.isMobilePhone);
  }

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
    if (this.view === 'search' && state === 'peek') this.setCardState('full');
    else if (this.view === 'search' && state === 'full') this.setCardState('peek');
  }

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
    const state = this.card.dataset.state;
    let visibleHeight = 0;
    if (state === 'peek') {
      visibleHeight = this.cardPeekHeight();
    } else if (state === 'full') {
      const renderedHeight = this.card.offsetHeight || this.cardRestingHeight();
      const restingHeight = this.cardRestingHeight();
      visibleHeight = Math.min(renderedHeight, restingHeight);
    }
    document.documentElement.style.setProperty('--mobile-card-visible-height', `${visibleHeight}px`);
  }

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

  cardFullHeight() {
    const borders = this.card.offsetHeight - this.card.clientHeight;
    const maximumHeightPixels = (window.visualViewport?.height ?? innerHeight) * 0.6;
    return Math.min(this.card.scrollHeight + borders, maximumHeightPixels);
  }

  syncCardTouch() {
    const state = this.card.dataset.state;
    const isFullscreenScrollable =
      state === 'fullscreen' && this.card.scrollHeight > this.card.clientHeight + 1;
    if (isFullscreenScrollable) this.card.style.touchAction = 'pan-y';
    else this.card.style.removeProperty('touch-action');
    this.syncMobileCardOffset();
  }

  revealFocusedCardContent(target) {
    if (!this.isMobilePhone || this.card.dataset.state !== 'full' || !this.cardBody.contains(target)) return;
    const cardBox = this.card.getBoundingClientRect();
    const targetBox = target.getBoundingClientRect();
    if (targetBox.bottom <= cardBox.bottom + 1 && targetBox.top >= cardBox.top - 1) return;
    this.setCardState('fullscreen');
    this.scrollCardTargetIntoView(target);
  }

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

  cardRestingHeight() {
    const state = this.card.dataset.state;
    if (state === 'peek') return this.cardPeekHeight();
    if (state === 'fullscreen') return window.visualViewport?.height ?? innerHeight;
    return this.cardFullHeight();
  }

  cardRestingBottomInset() {
    const keyboardInset = parseFloat(
      getComputedStyle(document.documentElement).getPropertyValue('--keyboard-inset')
    );
    return (Number.isFinite(keyboardInset) ? keyboardInset : 0) + PHONE_CARD_BOTTOM_GAP_PIXELS;
  }

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
    style.maxHeight = 'none';
    style.bottom = 'auto';
    style.left = `${frame.rect.inset}px`;
    style.right = `${frame.rect.inset}px`;
  }

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
      ? cardStateAfterSwipe({state, direction, resultsBehind: this.view === 'search'})
      : cardStateAfterSwipeWithoutFullscreen({state, direction, resultsBehind: this.view === 'search'});
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

  #isDesktopResultsPanelVisible() {
    return !this.mobileLayoutQuery.matches &&
      !this.desktopSearchPanel.hidden &&
      this.desktopSearchPanel.dataset.state !== 'empty';
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
    // The keyboard would cover these options and the end of the results list above them.
    document.querySelector('.dock-footer').hidden = this.keyboardOpen();
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
      details: detailsGeometryForMap(details, map, {detailsTop, isFullscreenCard}),
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
