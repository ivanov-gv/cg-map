// All geometry is in CSS pixels in the map container, including the keyboard's visible viewport.

// Device class thresholds mirror the CSS custom media in style.css.
// Flip: width ≤ 400 AND height ≤ 400 (small cover screens, nearly square).
// Mobile: width ≤ 720 (phones and small tablets), excluding Flip.
// Desktop: everything else.
const FLIP_MAX_WIDTH = 400;
const FLIP_MAX_HEIGHT = 400;
const MOBILE_MAX_WIDTH = 720;

/**
 * Returns the current device class: "flip", "mobile", or "desktop".
 * Uses innerWidth/innerHeight so it works in both browser and test contexts.
 */
export function getDeviceClass(width, height) {
  const viewWidth = width ?? window.innerWidth;
  const viewHeight = height ?? window.innerHeight;
  if (viewWidth <= FLIP_MAX_WIDTH && viewHeight <= FLIP_MAX_HEIGHT) return 'flip';
  if (viewWidth <= MOBILE_MAX_WIDTH) return 'mobile';
  return 'desktop';
}

export function searchBounds({height, top = 0, inset = 12}) {
  // Header, fixed categories, and results occupy the upper half of the unobscured screen.
  return {top: top + inset + 70, maxHeight: Math.max(0, height / 2 - inset - 70)};
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
  routeBottom = 0,
  mobile: isMobileLayout = false
}) {
  let left = Math.max(16, dockRight ? dockRight + 16 : 0);
  const right = width - 72;
  let top = Math.max(visibleTop + 16, headerBottom + 16, searchBottom + 16, routeBottom + 16);
  let bottom = Math.min(height - 20, visibleTop + visibleHeight - 20);
  if (details) {
    if (isMobileLayout) bottom = Math.min(bottom, details.top - 16);
    else left = Math.max(left, details.right + 16);
  }
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

// Swiping down steps back through what the card covers: full card, then peek above the results, then closed.
export function cardStateAfterSwipe({state, direction, resultsBehind}) {
  if (direction === 'up') return 'full';
  return state === 'full' && resultsBehind ? 'peek' : 'closed';
}

const SWIPE_THRESHOLD_PIXELS = 24;
const DRAG_START_PIXELS = 6;
// One trackpad gesture fires many wheel events; it may change the card state only once.
const WHEEL_GESTURE_MILLISECONDS = 600;
// A smaller gap can be browser chrome rather than an on-screen keyboard.
const MINIMUM_KEYBOARD_HEIGHT_PIXELS = 100;

export class MapInterface {
  constructor({onSearch, onChange, onViewport, onCardSwipedAway, resultsLabel}) {
    Object.assign(this, {onSearch, onChange, onViewport, onCardSwipedAway, resultsLabel});
    this.view = 'closed';
    this.areResultsMinimized = false;
    this.mobileLayoutQuery = matchMedia('(max-width: 720px)');
    this.search = document.getElementById('search');
    this.menu = document.getElementById('menu-toggle');
    this.panel = document.getElementById('browse-panel');
    this.dock = document.getElementById('dock-content');
    this.bubble = document.getElementById('search-bubble');
    this.strip = document.getElementById('results-strip');
    this.card = document.getElementById('place-card');
    this.cardHead = document.getElementById('place-head');
    this.cardBody = document.getElementById('place-body');
    this.cardHandle = document.getElementById('card-handle');
    this.trigger = this.menu;
    this.isRestoringFocus = false;
    this.menu.addEventListener('click', () => {
      this.trigger = this.menu;
      if (this.mobileLayoutQuery.matches) this.search.blur();
      this.setView(this.view === 'dock' ? 'closed' : 'dock');
      this.onViewport?.();
    });
    this.strip.addEventListener('click', () => this.setCardState('peek'));
    this.cardHandle.addEventListener('click', () => {
      if (this.view === 'search') this.setCardState(this.card.dataset.state === 'full' ? 'peek' : 'full');
    });
    for (const type of ['focus', 'click'])
      this.search.addEventListener(type, () => {
        if (!this.isRestoringFocus) this.openSearch();
      });
    this.mobileLayoutQuery.addEventListener('change', () => {
      if (this.view === 'search' && !this.mobileLayoutQuery.matches) this.setView('dock');
      if (!this.card.hidden) this.syncCardForLayout();
      this.syncViewport();
    });
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
    this.syncViewport(false);
  }

  openSearch() {
    this.trigger = this.search;
    // Search stays in the view it started from; only choosing a result leaves the phone dock.
    const view = this.mobileLayoutQuery.matches && this.view !== 'dock' ? 'search' : 'dock';
    const hasViewChanged = view !== this.view;
    this.setView(view);
    if (hasViewChanged) this.onSearch?.();
    else if (this.areResultsMinimized) this.setCardState('peek');
  }

  setView(view) {
    this.view = view;
    if (view !== 'search') {
      this.areResultsMinimized = false;
      // A peek only makes sense above open results.
      if (this.card.dataset.state === 'peek') this.setCardState('full');
    }
    const target = view === 'search' ? this.bubble : document.getElementById('dock-main');
    if (this.panel.parentElement !== target) target.append(this.panel);
    this.dock.hidden = view !== 'dock';
    this.syncResultsVisibility();
    this.syncCardHandle();
    document.body.dataset.view = view;
    this.menu.setAttribute('aria-expanded', String(view === 'dock'));
    this.menu.setAttribute('aria-label', view === 'dock' ? 'Close menu' : 'Open menu');
    this.search.setAttribute('aria-expanded', String(view !== 'closed'));
    this.onChange?.();
  }

  syncResultsVisibility() {
    const isSearching = this.view === 'search';
    this.bubble.hidden = !isSearching || this.areResultsMinimized;
    this.strip.hidden = !isSearching || !this.areResultsMinimized;
    if (!this.strip.hidden)
      document.getElementById('results-strip-label').textContent = this.resultsLabel?.() ?? '';
  }

  // Call after the card's content is in place and it is no longer hidden.
  placeCardOpened() {
    if (this.mobileLayoutQuery.matches && this.view === 'dock') this.setView('search');
    this.syncCardForLayout();
  }

  resetCardState() {
    delete this.card.dataset.state;
    this.card.style.removeProperty('touch-action');
    this.cardBody.inert = false;
    this.areResultsMinimized = false;
    this.syncResultsVisibility();
  }

  syncCardForLayout() {
    if (!this.mobileLayoutQuery.matches) {
      this.resetCardState();
      return;
    }
    this.setCardState(this.view === 'search' ? 'peek' : 'full', {notify: false});
  }

  setCardState(state, {notify = true} = {}) {
    this.card.dataset.state = state;
    const isExpanded = state === 'full';
    // Clipped controls must not stay reachable by keyboard.
    this.cardBody.inert = !isExpanded;
    if (this.view === 'search') this.areResultsMinimized = isExpanded;
    this.syncResultsVisibility();
    this.syncCardHandle();
    this.card.style.setProperty('--card-head', `${this.cardHeadBottom()}px`);
    this.card.style.setProperty('--card-peek', `${this.cardPeekHeight()}px`);
    this.syncCardTouch();
    if (notify) this.onViewport?.();
  }

  // The handle only switches between peek and full above results; with none behind the card, swiping closes it.
  syncCardHandle() {
    const isExpanded = this.card.dataset.state === 'full';
    const isHandleUsable = this.view === 'search';
    this.cardHandle.tabIndex = isHandleUsable ? 0 : -1;
    this.cardHandle.setAttribute('aria-hidden', String(!isHandleUsable));
    this.cardHandle.setAttribute('aria-expanded', String(isExpanded));
    this.cardHandle.setAttribute('aria-label', isExpanded ? 'Show less' : 'Show full details');
  }

  cardHeadBottom() {
    return this.cardHead.offsetTop + this.cardHead.offsetHeight;
  }

  cardPeekHeight() {
    return this.cardHeadBottom() + 2 * this.card.clientTop;
  }

  // Only a full card too long for its resting height keeps vertical touches for its own scrolling.
  syncCardTouch() {
    const borders = this.card.offsetHeight - this.card.clientHeight;
    const isCardScrollable =
      this.card.dataset.state === 'full' && this.card.scrollHeight + borders > this.cardRestingHeight() + 1;
    if (isCardScrollable) this.card.style.touchAction = 'pan-y';
    else this.card.style.removeProperty('touch-action');
  }

  // The card's height once its max-height transition settles, so the camera aims for the final layout.
  cardRestingHeight() {
    if (this.card.dataset.state === 'peek') return this.cardPeekHeight();
    const borders = this.card.offsetHeight - this.card.clientHeight;
    const maximumHeightPixels = (window.visualViewport?.height ?? innerHeight) * 0.6;
    return Math.min(this.card.scrollHeight + borders, maximumHeightPixels);
  }

  swipeCard(direction) {
    const next = cardStateAfterSwipe({
      state: this.card.dataset.state,
      direction,
      resultsBehind: this.view === 'search'
    });
    if (next === 'closed') this.onCardSwipedAway?.();
    else this.setCardState(next);
  }

  wireCardGestures() {
    let drag = null;
    this.card.addEventListener('pointerdown', (event) => {
      if (!this.mobileLayoutQuery.matches || event.button || event.target.closest('a, .point-actions'))
        return;
      const isOnCardHeader = !!event.target.closest('#card-handle, #place-head');
      if (!isOnCardHeader && this.card.scrollTop > 0) return;
      drag = {
        id: event.pointerId,
        startYPixels: event.clientY,
        startHeightPixels: this.card.offsetHeight,
        hasMoved: false
      };
    });
    this.card.addEventListener('pointermove', (event) => {
      if (event.pointerId !== drag?.id) return;
      const deltaYPixels = event.clientY - drag.startYPixels;
      if (!drag.hasMoved && Math.abs(deltaYPixels) < DRAG_START_PIXELS) return;
      if (!drag.hasMoved) {
        // Capturing only now leaves a plain tap to reach the handle as a normal click.
        drag.hasMoved = true;
        this.card.setPointerCapture(event.pointerId);
        this.card.classList.add('dragging');
      }
      const draggedHeightPixels = drag.startHeightPixels - deltaYPixels;
      const minimumHeightPixels = Math.min(this.cardPeekHeight(), drag.startHeightPixels);
      this.card.style.maxHeight = `${Math.max(minimumHeightPixels, draggedHeightPixels)}px`;
      this.card.style.transform =
        draggedHeightPixels < minimumHeightPixels
          ? `translateY(${minimumHeightPixels - draggedHeightPixels}px)`
          : '';
    });
    const finish = (event) => {
      if (event.pointerId !== drag?.id) return;
      const {hasMoved, startYPixels} = drag;
      drag = null;
      if (!hasMoved) return;
      this.card.classList.remove('dragging');
      this.card.style.removeProperty('max-height');
      this.card.style.removeProperty('transform');
      if (event.type === 'pointercancel') return;
      const deltaYPixels = event.clientY - startYPixels;
      if (deltaYPixels > SWIPE_THRESHOLD_PIXELS) this.swipeCard('down');
      else if (deltaYPixels < -SWIPE_THRESHOLD_PIXELS && this.card.dataset.state === 'peek')
        this.swipeCard('up');
    };
    this.card.addEventListener('pointerup', finish);
    this.card.addEventListener('pointercancel', finish);
    let wheelGestureEndsMilliseconds = 0;
    this.card.addEventListener(
      'wheel',
      (event) => {
        if (!this.mobileLayoutQuery.matches) return;
        const isOpeningPeek = this.card.dataset.state === 'peek' && event.deltaY > 0;
        const isSwipingDown = event.deltaY < 0 && this.card.scrollTop === 0;
        if (!isOpeningPeek && !isSwipingDown) return;
        event.preventDefault();
        if (performance.now() < wheelGestureEndsMilliseconds) return;
        wheelGestureEndsMilliseconds = performance.now() + WHEEL_GESTURE_MILLISECONDS;
        this.swipeCard(isOpeningPeek ? 'up' : 'down');
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
    const bounds = searchBounds({height, top, inset});
    const style = document.documentElement.style;
    style.setProperty('--visible-height', `${height}px`);
    style.setProperty('--visible-top', `${top}px`);
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
    const detailsTop = isPhoneCard ? details.bottom - this.cardRestingHeight() : details?.top;
    const searchPanel = this.areResultsMinimized ? this.strip : this.bubble;
    return {
      width: map.width,
      height: map.height,
      visibleTop: Math.max(0, (viewport?.offsetTop ?? 0) - map.top),
      visibleHeight: viewport?.height ?? innerHeight,
      headerBottom: header.bottom - map.top,
      searchBottom: this.view === 'search' ? searchPanel.getBoundingClientRect().bottom - map.top : 0,
      dockRight:
        this.view === 'dock'
          ? document.querySelector('.sidebar').getBoundingClientRect().right - map.left
          : 0,
      details: details && {top: detailsTop - map.top, right: details.right - map.left},
      routeBottom: route.hidden ? 0 : route.getBoundingClientRect().bottom - map.top,
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
