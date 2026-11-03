// All geometry is in CSS pixels in the map container, including the keyboard's visible viewport.
export function searchBounds({height, top = 0, inset = 12}) {
  // Header, fixed categories, and results occupy the upper half of the unobscured screen.
  return {top: top + inset + 70, maxHeight: Math.max(0, height / 2 - inset - 70)};
}

export function uncoveredMapOffset({width, height, visibleTop = 0, visibleHeight = height,
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
  return [(left + right) / 2 - width / 2, (top + bottom) / 2 - height / 2];
}

export class MapInterface {
  constructor({onSearch, onChange, onViewport}) {
    Object.assign(this, {onSearch, onChange, onViewport});
    this.view = 'closed';
    this.mobile = matchMedia('(max-width: 720px)');
    this.search = document.getElementById('search');
    this.menu = document.getElementById('menu-toggle');
    this.panel = document.getElementById('browse-panel');
    this.dock = document.getElementById('dock-content');
    this.bubble = document.getElementById('search-bubble');
    this.trigger = this.menu;
    this.restoringFocus = false;
    this.menu.addEventListener('click', () => {
      this.trigger = this.menu;
      if (this.mobile.matches) this.search.blur();
      this.setView(this.view === 'dock' ? 'closed' : 'dock');
    });
    for (const type of ['focus', 'click']) this.search.addEventListener(type, () => {
      if (!this.restoringFocus) this.openSearch();
    });
    this.mobile.addEventListener('change', () => {
      if (this.view === 'search' && !this.mobile.matches) this.setView('dock');
      this.syncViewport();
    });
    window.visualViewport?.addEventListener('resize', () => this.syncViewport());
    window.visualViewport?.addEventListener('scroll', () => this.syncViewport());
    window.addEventListener('resize', () => this.syncViewport());
    this.observer = new ResizeObserver(() => this.onViewport?.());
    this.observer.observe(this.bubble);
    this.observer.observe(document.getElementById('place-card'));
    this.syncViewport(false);
  }

  openSearch() {
    this.trigger = this.search;
    const view = this.mobile.matches ? 'search' : 'dock';
    const changed = view !== this.view;
    this.setView(view);
    if (changed) this.onSearch?.();
  }

  setView(view) {
    this.view = view;
    const target = view === 'search' ? this.bubble : document.getElementById('dock-main');
    if (this.panel.parentElement !== target) target.append(this.panel);
    this.dock.hidden = view !== 'dock';
    this.bubble.hidden = view !== 'search';
    document.body.dataset.view = view;
    this.menu.setAttribute('aria-expanded', String(view === 'dock'));
    this.menu.setAttribute('aria-label', view === 'dock' ? 'Close menu' : 'Open menu');
    this.search.setAttribute('aria-expanded', String(view !== 'closed'));
    this.onChange?.();
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
    if (notify) this.onViewport?.();
  }

  mapOffset() {
    const map = document.getElementById('map').getBoundingClientRect();
    const header = document.querySelector('.search-bar').getBoundingClientRect();
    const card = document.getElementById('place-card');
    const route = document.getElementById('route-endpoints');
    const viewport = window.visualViewport;
    const details = card.hidden ? null : card.getBoundingClientRect();
    return uncoveredMapOffset({
      width: map.width, height: map.height,
      visibleTop: Math.max(0, (viewport?.offsetTop ?? 0) - map.top),
      visibleHeight: viewport?.height ?? innerHeight,
      headerBottom: header.bottom - map.top,
      searchBottom: this.view === 'search' ? this.bubble.getBoundingClientRect().bottom - map.top : 0,
      dockRight: this.view === 'dock' ? document.querySelector('.sidebar').getBoundingClientRect().right - map.left : 0,
      details: details && {top: details.top - map.top, right: details.right - map.left},
      routeBottom: route.hidden ? 0 : route.getBoundingClientRect().bottom - map.top,
      mobile: this.mobile.matches
    });
  }
}
