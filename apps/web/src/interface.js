// All geometry is in CSS pixels in the map container, including the keyboard's visible viewport.
export function searchBounds({height, top = 0, inset = 12}) {
  // Header, fixed categories, and results occupy the upper half of the unobscured screen.
  return {top: top + inset + 70, maxHeight: Math.max(0, height / 2 - inset - 70)};
}

// The part of the map no panel covers, in map container pixels.
export function uncoveredMapArea({width, height, visibleTop = 0, visibleHeight = height,
  headerBottom = 0, searchBottom = 0, dockRight = 0, details = null, routeBottom = 0, mobile = false}) {
  let left = Math.max(16, dockRight ? dockRight + 16 : 0);
  const right = width - 72;
  let top = Math.max(visibleTop + 16, headerBottom + 16, searchBottom + 16, routeBottom + 16);
  let bottom = Math.min(height - 20, visibleTop + visibleHeight - 20);
  if (details) {
    if (mobile) bottom = Math.min(bottom, details.top - 16);
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
export const FOCUS_ZONE_RATIO = .75;

export function isInFocusZone({x, y}, {left, right, top, bottom}) {
  const insetX = (right - left) * (1 - FOCUS_ZONE_RATIO) / 2;
  const insetY = (bottom - top) * (1 - FOCUS_ZONE_RATIO) / 2;
  return x >= left + insetX && x <= right - insetX && y >= top + insetY && y <= bottom - insetY;
}

// Swiping down steps back through what the card covers: full card, then peek above the results, then closed.
export function cardStateAfterSwipe({state, direction, resultsBehind}) {
  if (direction === 'up') return 'full';
  return state === 'full' && resultsBehind ? 'peek' : 'closed';
}

const SWIPE_THRESHOLD_PX = 24;
const DRAG_START_PX = 6;
// One trackpad gesture fires many wheel events; it may change the card state only once.
const WHEEL_GESTURE_MS = 600;
// A smaller gap can be browser chrome rather than an on-screen keyboard.
const KEYBOARD_MIN_HEIGHT_PX = 100;

export class MapInterface {
  constructor({onSearch, onChange, onViewport, onCardSwipedAway, resultsLabel}) {
    Object.assign(this, {onSearch, onChange, onViewport, onCardSwipedAway, resultsLabel});
    this.view = 'closed';
    this.resultsMinimized = false;
    this.mobile = matchMedia('(max-width: 720px)');
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
    this.restoringFocus = false;
    this.menu.addEventListener('click', () => {
      this.trigger = this.menu;
      if (this.mobile.matches) this.search.blur();
      this.setView(this.view === 'dock' ? 'closed' : 'dock');
      this.onViewport?.();
    });
    this.strip.addEventListener('click', () => this.setCardState('peek'));
    this.cardHandle.addEventListener('click', () => {
      if (this.view === 'search') this.setCardState(this.card.dataset.state === 'full' ? 'peek' : 'full');
    });
    for (const type of ['focus', 'click']) this.search.addEventListener(type, () => {
      if (!this.restoringFocus) this.openSearch();
    });
    this.mobile.addEventListener('change', () => {
      if (this.view === 'search' && !this.mobile.matches) this.setView('dock');
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
    const view = this.mobile.matches && this.view !== 'dock' ? 'search' : 'dock';
    const changed = view !== this.view;
    this.setView(view);
    if (changed) this.onSearch?.();
    else if (this.resultsMinimized) this.setCardState('peek');
  }

  setView(view) {
    this.view = view;
    if (view !== 'search') {
      this.resultsMinimized = false;
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
    const searching = this.view === 'search';
    this.bubble.hidden = !searching || this.resultsMinimized;
    this.strip.hidden = !searching || !this.resultsMinimized;
    if (!this.strip.hidden) document.getElementById('results-strip-label').textContent = this.resultsLabel?.() ?? '';
  }

  // Call after the card's content is in place and it is no longer hidden.
  placeCardOpened() {
    if (this.mobile.matches && this.view === 'dock') this.setView('search');
    this.syncCardForLayout();
  }

  resetCardState() {
    delete this.card.dataset.state;
    this.card.style.removeProperty('touch-action');
    this.cardBody.inert = false;
    this.resultsMinimized = false;
    this.syncResultsVisibility();
  }

  syncCardForLayout() {
    if (!this.mobile.matches) {
      this.resetCardState();
      return;
    }
    this.setCardState(this.view === 'search' ? 'peek' : 'full', {notify: false});
  }

  setCardState(state, {notify = true} = {}) {
    this.card.dataset.state = state;
    const expanded = state === 'full';
    // Clipped controls must not stay reachable by keyboard.
    this.cardBody.inert = !expanded;
    if (this.view === 'search') this.resultsMinimized = expanded;
    this.syncResultsVisibility();
    this.syncCardHandle();
    this.card.style.setProperty('--card-head', `${this.cardHeadBottom()}px`);
    this.card.style.setProperty('--card-peek', `${this.cardPeekHeight()}px`);
    this.syncCardTouch();
    if (notify) this.onViewport?.();
  }

  // The handle only switches between peek and full above results; with none behind the card, swiping closes it.
  syncCardHandle() {
    const expanded = this.card.dataset.state === 'full';
    const usable = this.view === 'search';
    this.cardHandle.tabIndex = usable ? 0 : -1;
    this.cardHandle.setAttribute('aria-hidden', String(!usable));
    this.cardHandle.setAttribute('aria-expanded', String(expanded));
    this.cardHandle.setAttribute('aria-label', expanded ? 'Show less' : 'Show full details');
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
    const scrollable = this.card.dataset.state === 'full' && this.card.scrollHeight + borders > this.cardRestingHeight() + 1;
    if (scrollable) this.card.style.touchAction = 'pan-y';
    else this.card.style.removeProperty('touch-action');
  }

  // The card's height once its max-height transition settles, so the camera aims for the final layout.
  cardRestingHeight() {
    if (this.card.dataset.state === 'peek') return this.cardPeekHeight();
    const borders = this.card.offsetHeight - this.card.clientHeight;
    const maxHeight = (window.visualViewport?.height ?? innerHeight) * .6;
    return Math.min(this.card.scrollHeight + borders, maxHeight);
  }

  swipeCard(direction) {
    const next = cardStateAfterSwipe({state: this.card.dataset.state, direction, resultsBehind: this.view === 'search'});
    if (next === 'closed') this.onCardSwipedAway?.();
    else this.setCardState(next);
  }

  wireCardGestures() {
    let drag = null;
    this.card.addEventListener('pointerdown', event => {
      if (!this.mobile.matches || event.button || event.target.closest('a, .point-actions')) return;
      const onHead = !!event.target.closest('#card-handle, #place-head');
      if (!onHead && this.card.scrollTop > 0) return;
      drag = {id: event.pointerId, startY: event.clientY, startHeight: this.card.offsetHeight, moved: false};
    });
    this.card.addEventListener('pointermove', event => {
      if (event.pointerId !== drag?.id) return;
      const deltaY = event.clientY - drag.startY;
      if (!drag.moved && Math.abs(deltaY) < DRAG_START_PX) return;
      if (!drag.moved) {
        // Capturing only now leaves a plain tap to reach the handle as a normal click.
        drag.moved = true;
        this.card.setPointerCapture(event.pointerId);
        this.card.classList.add('dragging');
      }
      const dragged = drag.startHeight - deltaY;
      const floor = Math.min(this.cardPeekHeight(), drag.startHeight);
      this.card.style.maxHeight = `${Math.max(floor, dragged)}px`;
      this.card.style.transform = dragged < floor ? `translateY(${floor - dragged}px)` : '';
    });
    const finish = event => {
      if (event.pointerId !== drag?.id) return;
      const {moved, startY} = drag;
      drag = null;
      if (!moved) return;
      this.card.classList.remove('dragging');
      this.card.style.removeProperty('max-height');
      this.card.style.removeProperty('transform');
      if (event.type === 'pointercancel') return;
      const deltaY = event.clientY - startY;
      if (deltaY > SWIPE_THRESHOLD_PX) this.swipeCard('down');
      else if (deltaY < -SWIPE_THRESHOLD_PX && this.card.dataset.state === 'peek') this.swipeCard('up');
    };
    this.card.addEventListener('pointerup', finish);
    this.card.addEventListener('pointercancel', finish);
    let wheelGestureEnds = 0;
    this.card.addEventListener('wheel', event => {
      if (!this.mobile.matches) return;
      const openingPeek = this.card.dataset.state === 'peek' && event.deltaY > 0;
      const swipingDown = event.deltaY < 0 && this.card.scrollTop === 0;
      if (!openingPeek && !swipingDown) return;
      event.preventDefault();
      if (performance.now() < wheelGestureEnds) return;
      wheelGestureEnds = performance.now() + WHEEL_GESTURE_MS;
      this.swipeCard(openingPeek ? 'up' : 'down');
    }, {passive: false});
  }

  // The phone category strip has no scrollbar, so a mouse wheel scrolls it sideways.
  wireCategoryWheel() {
    const strip = document.getElementById('categories');
    strip.addEventListener('wheel', event => {
      if (!this.mobile.matches || !event.deltaY || event.deltaX) return;
      event.preventDefault();
      strip.scrollLeft += event.deltaY;
    }, {passive: false});
  }

  restoreFocus(element) {
    this.restoringFocus = true;
    element?.focus({preventScroll: true});
    this.restoringFocus = false;
  }

  close(restoreFocus = false) {
    this.setView('closed');
    if (restoreFocus) this.restoreFocus(this.trigger);
  }

  keyboardOpen() {
    const viewport = window.visualViewport;
    // A pinch-zoomed page also shrinks the visual viewport, without any keyboard.
    if (!this.mobile.matches || (viewport?.scale ?? 1) > 1.01) return false;
    const visibleHeight = viewport?.height ?? innerHeight;
    return innerHeight - visibleHeight > KEYBOARD_MIN_HEIGHT_PX;
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
    const phoneCard = !!details && this.mobile.matches;
    const detailsTop = phoneCard ? details.bottom - this.cardRestingHeight() : details?.top;
    const searchPanel = this.resultsMinimized ? this.strip : this.bubble;
    return {
      width: map.width, height: map.height,
      visibleTop: Math.max(0, (viewport?.offsetTop ?? 0) - map.top),
      visibleHeight: viewport?.height ?? innerHeight,
      headerBottom: header.bottom - map.top,
      searchBottom: this.view === 'search' ? searchPanel.getBoundingClientRect().bottom - map.top : 0,
      dockRight: this.view === 'dock' ? document.querySelector('.sidebar').getBoundingClientRect().right - map.left : 0,
      details: details && {top: detailsTop - map.top, right: details.right - map.left},
      routeBottom: route.hidden ? 0 : route.getBoundingClientRect().bottom - map.top,
      mobile: this.mobile.matches
    };
  }

  mapOffset() {
    return uncoveredMapOffset(this.mapGeometry());
  }

  mapArea() {
    return uncoveredMapArea(this.mapGeometry());
  }
}
