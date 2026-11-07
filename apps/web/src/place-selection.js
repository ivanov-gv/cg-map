import {isInFocusZone} from './interface.js';
import {requestedPlaceMarker} from '@ivanov-gv/map-core';
import {categories, featureCollection, selectNearestPlaces} from './core.js';
import {createElement, elementById} from './dom.js';
import {listingButton, renderPlaceDetails} from './place-details.js';

// Owns one selection transaction: listing/point/chooser, map highlights, deferred camera framing and focus.
// Directory and map getters always read current state, including data that arrives after construction.
export class PlaceSelection {
  #context;
  #state = {
    selectedPlace: null,
    selectedPoint: null,
    returnFocusElement: null,
    previewPlace: null,
    pendingReveal: null,
    isChoosingListing: false,
    requestedMarkerKey: null
  };

  constructor(context) {
    this.#context = context;
    // These actions cross the map/DOM callback boundary and must retain their owning controller.
    for (const action of ['showPlace', 'showPoint', 'showChooser', 'close'])
      this[action] = this[action].bind(this);
  }

  get #map() {
    return this.#context.map();
  }
  get #interface() {
    return this.#context.interface();
  }
  get #directory() {
    return this.#context.directory();
  }
  get #objectSelection() {
    return this.#context.objectSelection();
  }
  get selectedPlace() {
    return this.#state.selectedPlace;
  }
  get previewPlace() {
    return this.#state.previewPlace;
  }
  get point() {
    return this.#state.selectedPoint;
  }

  // Explicit selection and location requests mark the map explored before moving its camera.
  focusCoordinates(coordinates, zoom = 15, durationMilliseconds = 450) {
    if (!this.#map) return;
    this.#context.onExploreMap();
    this.#map.easeTo({
      center: coordinates,
      zoom: Math.max(this.#map.getZoom(), zoom),
      offset: this.#interface.mapOffset(),
      duration: this.#context.prefersReducedMotion ? 0 : durationMilliseconds
    });
  }

  // Keep a chosen place visible with as little camera movement as possible: pan only when it leaves the focus zone.
  revealCoordinates(coordinates, {zoom = 15, duration: durationMilliseconds = 450} = {}) {
    if (!this.#map) return;
    this.#context.onExploreMap();
    const needsZoom = this.#map.getZoom() < zoom;
    if (!needsZoom && isInFocusZone(this.#map.project(coordinates), this.#interface.mapArea())) return;
    this.#map.easeTo({
      center: coordinates,
      zoom: Math.max(this.#map.getZoom(), zoom),
      offset: this.#interface.mapOffset(),
      duration: this.#context.prefersReducedMotion ? 0 : durationMilliseconds
    });
  }

  // The camera stays still while the keyboard is up; a pending reveal waits for the layout it leaves behind.
  flushPendingReveal() {
    const coordinates = this.#state.pendingReveal?.coordinates ?? this.#state.selectedPoint?.coordinates;
    if (!this.#state.pendingReveal || !coordinates || this.#interface.keyboardOpen()) return;
    const options = this.#state.pendingReveal;
    this.#state.pendingReveal = null;
    this.revealCoordinates(coordinates, options);
  }

  // Admission is fixed by each band's zoom range. Only the selected listing, or otherwise the leading explicit result,
  // may also appear below its threshold.
  updatePlaceLayers() {
    if (!this.#context.isMapReady() || this.#directory.loadingError) return;
    this.#objectSelection.setPreview(
      this.#state.selectedPlace || !this.#state.previewPlace
        ? null
        : this.#directory.markerKeysByPlaceId.get(this.#state.previewPlace.properties.id)
    );
    const {features, maxzoom} = requestedPlaceMarker(
      this.#state.selectedPlace ?? this.#state.previewPlace,
      this.#directory.filteredPlaces,
      this.#directory.markerKeysByPlaceId,
      this.#directory.visibilityConfig
    );
    const key = `${features[0]?.properties.activeIds}@${maxzoom}`;
    if (key === this.#state.requestedMarkerKey) return;
    this.#state.requestedMarkerKey = key;
    this.#map.getSource('requested-place').setData(featureCollection(features));
    this.#map.setLayerZoomRange('search-place', 0, maxzoom);
  }

  // A leading explicit result may be previewed only while results are open and map layers are ready.
  previewResults() {
    if (
      !this.#context.isMapReady() ||
      this.#directory.loadingError ||
      this.#interface.view === 'closed' ||
      !this.hasExplicitFilter()
    )
      return;
    this.#state.previewPlace =
      selectNearestPlaces(this.#directory.filteredPlaces, this.#map.getCenter().toArray(), 1)[0]?.feature ??
      null;
    this.updatePlaceLayers();
    this.#context.onResultsChanged();
  }

  // While choosing among real listings, endpoint actions must stay unavailable.
  setChoosing(isChoosingListing) {
    this.#state.isChoosingListing = isChoosingListing;
    elementById('point-actions').hidden = isChoosingListing;
  }

  // Clear the card and map selection together, then restore the originating control when requested.
  close(shouldRestoreFocus = true) {
    const hadPoint = !!this.#state.selectedPoint || this.#state.isChoosingListing;
    this.#state.selectedPoint = null;
    this.#state.selectedPlace = null;
    this.#state.pendingReveal = null;
    this.setChoosing(false);
    elementById('place-card').hidden = true;
    this.#interface?.resetCardState();
    this.#objectSelection?.clear();
    this.updatePlaceLayers();
    this.markCurrentResult();
    if (shouldRestoreFocus && this.#state.returnFocusElement)
      this.#interface?.restoreFocus(
        this.#state.returnFocusElement.isConnected && this.#state.returnFocusElement.getClientRects().length
          ? this.#state.returnFocusElement
          : elementById('search')
      );
    else if (shouldRestoreFocus && hadPoint) this.#map?.getCanvas().focus({preventScroll: true});
    this.#state.returnFocusElement = null;
    this.#context.onSelectionChanged();
  }

  // The current listing remains discoverable in the result list without changing its order.
  markCurrentResult() {
    const currentId = String((this.#state.selectedPlace ?? this.#state.previewPlace)?.properties.id);
    for (const row of elementById('results').querySelectorAll('.result')) {
      if (row.dataset.id === currentId) {
        row.setAttribute('aria-current', 'true');
        row.scrollIntoView({block: 'nearest'});
      } else row.removeAttribute('aria-current');
    }
  }

  // Requires a ready map and initialized selection layers; opens a known listing and defers camera
  // framing until the keyboard is closed, preserving the originating control for focus restoration.
  showPlace(placeId, trigger) {
    const feature = this.#directory.placesById.get(String(placeId));
    if (!feature) return;
    this.setChoosing(false);
    this.#state.selectedPlace = feature;
    this.#state.selectedPoint = {
      name: feature.properties.name,
      coordinates: [...feature.geometry.coordinates]
    };
    this.#state.returnFocusElement = trigger ?? null;
    const properties = feature.properties;
    elementById('place-name').textContent = properties.name;
    elementById('place-category').textContent = categories[properties.category] ?? properties.category;
    renderPlaceDetails(feature);
    this.#state.previewPlace = null;
    this.updatePlaceLayers();
    elementById('search').blur();
    elementById('place-card').hidden = false;
    this.#interface.placeCardOpened();
    elementById('place-card').scrollTop = 0;
    this.#context.onSelectionChanged();
    this.markCurrentResult();
    this.#objectSelection.selectPlace(feature, this.#directory.markerKeysByPlaceId.get(properties.id));
    elementById('close-place').focus({preventScroll: true});
    this.#state.pendingReveal = {zoom: 15};
    this.flushPendingReveal();
  }

  // Keep every recorded entrance clear of the header and card, without zooming closer than the selected view.
  frameBuildingEntrances(entrances, coordinates) {
    const positions = [coordinates, ...entrances.map(entrance => entrance.coordinates)];
    const area = this.#interface.mapArea();
    const horizontalMarginPixels = Math.min(64, (area.right - area.left) / 4);
    const verticalMarginPixels = 32;
    const canvas = this.#map.getCanvas();
    const bounds = new maplibregl.LngLatBounds();
    for (const position of positions) bounds.extend(position);
    const padding = {
      left: area.left + horizontalMarginPixels,
      right: canvas.clientWidth - area.right + horizontalMarginPixels,
      top: area.top + verticalMarginPixels,
      bottom: canvas.clientHeight - area.bottom + verticalMarginPixels
    };
    this.#map.fitBounds(bounds, {
      padding,
      maxZoom: this.#map.getZoom(),
      duration: this.#context.prefersReducedMotion ? 0 : 450,
      retainPadding: false
    });
  }

  // Selection uses the existing details card and original footprint; entrance bounds keep the arrows visible.
  showPoint(point, feature = null) {
    this.close(false);
    this.#state.selectedPoint = point;
    elementById('place-name').textContent = point.name;
    elementById('place-category').textContent = point.kind;
    const details = elementById('place-details');
    details.replaceChildren();
    const coordinatesLine = point.coordinates
      .slice()
      .reverse()
      .map(coordinate => coordinate.toFixed(5))
      .join(', ');
    for (const text of [...point.details, coordinatesLine]) {
      if (text) details.append(createElement('p', text, 'detail'));
    }
    elementById('place-card').hidden = false;
    this.#state.previewPlace = null;
    this.updatePlaceLayers();
    this.#interface.close();
    this.#interface.placeCardOpened();
    this.#context.onSelectionChanged();
    this.#objectSelection.select(feature, point.coordinates);
    const footprintIndex =
      feature?.layer?.id === 'buildings' ? feature.id : feature?.properties?.footprintIndex;
    const entrances =
      point.kind === 'Building' ? this.#directory.buildingAddresses.get(footprintIndex)?.entrances : [];
    if (entrances?.length) {
      this.#state.selectedPoint = {...point, entrances};
      this.frameBuildingEntrances(entrances, point.coordinates);
    } else this.focusCoordinates(point.coordinates, this.#map.getZoom());
    elementById('close-place').focus({preventScroll: true});
  }

  // Several listings under one tap: same location, or nearby markers that overlap. Each stays a real listing.
  showChooser(listings, coordinates) {
    this.close(false);
    this.setChoosing(true);
    elementById('place-name').textContent = `${listings.length} places here`;
    elementById('place-category').textContent = 'Choose a listing';
    const details = elementById('place-details');
    details.replaceChildren();
    const list = createElement('div', undefined, 'place-chooser');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Listings at this point');
    for (const feature of listings)
      list.append(listingButton(feature, () => this.showPlace(feature.properties.id)));
    details.append(list);
    elementById('search').blur();
    elementById('place-card').hidden = false;
    this.#state.previewPlace = null;
    this.updatePlaceLayers();
    this.#interface.placeCardOpened();
    // The list must be usable at once, so a phone card opens full instead of as a header-only peek.
    if (this.#interface.view === 'search') this.#interface.setCardState('full');
    this.#context.onSelectionChanged();
    this.#state.pendingReveal = {zoom: this.#map.getZoom(), coordinates};
    this.flushPendingReveal();
    list.firstElementChild.focus({preventScroll: true});
  }

  // Reframe only after keyboard and camera changes settle; entrance bounds already include the card.
  viewportChanged() {
    const hasSelection = Boolean(this.#state.selectedPoint || this.#state.pendingReveal);
    if (!this.#context.isMapReady() || !hasSelection || this.#interface.keyboardOpen()) return;
    // Building bounds already account for the card; an intermediate zoom would undo their fit.
    if (this.#state.selectedPoint?.entrances?.length) {
      if (!this.#map.isMoving())
        this.frameBuildingEntrances(
          this.#state.selectedPoint.entrances,
          this.#state.selectedPoint.coordinates
        );
      return;
    }
    if (this.#map.isMoving()) {
      this.#state.pendingReveal ??= {zoom: this.#map.getZoom()};
      return;
    }
    if (this.#state.pendingReveal) {
      this.flushPendingReveal();
      return;
    }
    this.revealCoordinates(this.#state.selectedPoint.coordinates, {
      zoom: this.#map.getZoom(),
      duration: 0
    });
  }

  // A changed filter can invalidate a chooser or selected listing, but never silently select a different one.
  onFilterChanged() {
    const isSelectedPlaceExcluded =
      this.#state.selectedPlace &&
      !this.#directory.filteredPlaces.some(
        feature => feature.properties.id === this.#state.selectedPlace.properties.id
      );
    if (this.#state.isChoosingListing || isSelectedPlaceExcluded) this.close(false);
    this.clearPreview();
  }

  // Drop only the leading result; an explicitly selected listing keeps its highlight.
  clearPreview() {
    this.#state.previewPlace = null;
    this.updatePlaceLayers();
  }

  hasExplicitFilter() {
    return Boolean(elementById('search').value.trim()) || this.#directory.activeCategory !== 'all';
  }
}
