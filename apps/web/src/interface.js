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
    this.cardHandle.addEventListener('click', () => {
      if (this.view === 'search') this.setCardState(this.card.dataset.state === 'full' ? 'peek' : 'full');
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
    this.bubble.hidden = !isSearching || this.areResultsMinimized;
    this.strip.hidden = !isSearching || !this.areResultsMinimized;
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
    this.card.style.removeProperty('touch-action');
    this.cardBody.inert = false;
    this.areResultsMinimized = false;
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
    this.syncActiveChip();
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
    const detailsTop = isPhoneCard ? details.bottom - this.cardRestingHeight() : details?.top;
    const cardBox = details && {
      left: details.left - map.left,
      right: details.right - map.left,
      top: detailsTop - map.top,
      bottom: details.bottom - map.top
    };
    const searchPanel = this.areResultsMinimized ? this.strip : this.bubble;
    return {
      width: map.width,
      height: map.height,
      visibleTop: Math.max(0, (viewport?.offsetTop ?? 0) - map.top),
      visibleHeight: viewport?.height ?? innerHeight,
      headerBottom: header.bottom - map.top,
      searchBottom: this.view === 'search' ? searchPanel.getBoundingClientRect().bottom - map.top : 0,
      dockRight:
        (this.view === 'dock' || this.#isDesktopResultsPanelVisible())
          ? document.querySelector('.sidebar').getBoundingClientRect().right - map.left
          : 0,
      details: cardBox,
      coversBottom: isPhoneCard,
      routeBottom: route.hidden ? 0 : route.getBoundingClientRect().bottom - map.top
    };
  }

  mapOffset() {
    return uncoveredMapOffset(this.mapGeometry());
  }

  mapArea() {
    return uncoveredMapArea(this.mapGeometry());
  }
}
