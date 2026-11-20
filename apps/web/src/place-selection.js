import {isInFocusZone} from './interface.js';
import {requestedPlaceMarker} from '@ivanov-gv/map-core';
import {featureCollection, selectNearestPlaces} from './core.js';
import {elementById} from './dom.js';
import {
  buildObjectCard,
  buildPlaceCard,
  maximumNearbyPlaces,
  renderCardContent,
  setPlaceCardBuildingAddress
} from './place-details.js';

const selectionCameraDurationMilliseconds = 450;

// Owns one selection transaction: listing/point, map highlights, deferred camera framing and focus.
// Directory and map getters always read current state, including data that arrives after construction.
export class PlaceSelection {
  #context;
  #state = {
    selectedPlace: null,
    selectedPoint: null,
    selectedFootprintIndex: null,
    returnFocusElement: null,
    requestedPlace: null,
    pendingReveal: null,
    revealOnlyWhenNeeded: false,
    isChoosingListing: false,
    requestedMarkerKey: null,
    resolvedBuildingAddress: '',
    buildingAddressListenerInstalled: false
  };

  constructor(context) {
    this.#context = context;
    // These actions cross the map/DOM callback boundary and must retain their owning controller.
    for (const action of ['showPlace', 'showSearchResult', 'showPoint', 'showChooser', 'close'])
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
  get point() {
    return this.#state.selectedPoint;
  }
  // Only an explicit choice is current; the leading search match is not selected and stays green.
  get currentResultId() {
    return this.#state.selectedPlace?.properties.id ?? this.#state.selectedPoint?.id ?? null;
  }
  get selectedFootprintIndex() {
    return this.#state.selectedFootprintIndex;
  }
  get hasOpenCard() {
    return Boolean(this.#state.selectedPlace || this.#state.selectedPoint || this.#state.isChoosingListing);
  }

  #buildingAt(coordinates) {
    if (!this.#context.isMapReady() || !coordinates) return null;
    return this.#map.queryRenderedFeatures(this.#map.project(coordinates), {layers: ['buildings']})[0] ?? null;
  }

  // A building can span several tiles; one id-filtered query collects every rendered fragment.
  #buildingFootprintsFor(feature) {
    if (!this.#context.isMapReady()) return [];
    const footprintIndex =
      feature?.layer?.id === 'buildings' ? feature.id : feature?.properties?.footprintIndex;
    if (footprintIndex === undefined || footprintIndex === null) return [];
    const rendered = this.#map.queryRenderedFeatures({
      layers: ['buildings'],
      filter: ['==', ['id'], footprintIndex]
    });
    if (rendered.length) return rendered;
    return feature?.layer?.id === 'buildings' ? [feature] : [];
  }

  #buildingAddressFor(feature) {
    const address = this.#directory.buildingAddresses.get(feature?.id);
    return address ? this.#context.buildingAddress(address) : '';
  }

  // The first resolved address is kept for the selection, so a camera move cannot withdraw a recorded fact.
  #resolveBuildingAddress(feature) {
    if (!feature) return '';
    const footprintIndex = feature.properties?.footprintIndex;
    if (Number.isInteger(footprintIndex)) {
      const directAddress = this.#buildingAddressFor({id: footprintIndex});
      if (directAddress) return directAddress;
    }
    if (this.#state.resolvedBuildingAddress) return this.#state.resolvedBuildingAddress;
    return this.#buildingAddressFor(this.#buildingAt(feature.geometry.coordinates));
  }

  // A late address is patched into one row; the card is not rebuilt unless the selection changes.
  #refreshBuildingAddress = () => {
    const feature = this.#state.selectedPlace;
    if (!feature) return;
    const buildingAddress = this.#resolveBuildingAddress(feature);
    if (buildingAddress === this.#state.resolvedBuildingAddress) return;
    this.#state.resolvedBuildingAddress = buildingAddress;
    setPlaceCardBuildingAddress(buildingAddress);
  };

  #renderPlaceCard(feature) {
    const nearbyPlaces = selectNearestPlaces(
      this.#directory.allPlaces.filter(
        place => String(place.properties.id) !== String(feature.properties.id)
      ),
      feature.geometry.coordinates,
      maximumNearbyPlaces
    );
    renderCardContent(
      buildPlaceCard(feature, {
        sourceDate: this.#directory.sourceDate,
        buildingAddress: this.#state.resolvedBuildingAddress,
        nearbyPlaces
      })
    );
  }

  // Explicit selection and location requests mark the map explored before moving its camera.
  focusCoordinates(coordinates, zoom = 15, durationMilliseconds = selectionCameraDurationMilliseconds) {
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
  revealCoordinates(coordinates, {zoom = 15, duration: durationMilliseconds = selectionCameraDurationMilliseconds} = {}) {
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

  // Admission is fixed by each band's zoom range. The chosen listing, or otherwise the leading search match, may also
  // appear below its own threshold. Search highlights are green, so this icon never looks like a chosen result.
  updatePlaceLayers() {
    if (!this.#context.isMapReady() || this.#directory.loadingError) return;
    const {features, maxzoom} = requestedPlaceMarker(
      this.#state.selectedPlace ?? this.#state.requestedPlace,
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

  // The below-threshold icon exception follows the leading search match only while results are open and layers are ready.
  updateRequestedPlace() {
    if (
      !this.#context.isMapReady() ||
      this.#directory.loadingError ||
      !this.hasExplicitFilter() ||
      !this.#interface.areResultsVisible()
    )
      return;
    this.#state.requestedPlace =
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
    this.#state.selectedFootprintIndex = null;
    this.#state.selectedPlace = null;
    this.#state.pendingReveal = null;
    this.#state.revealOnlyWhenNeeded = false;
    this.#state.resolvedBuildingAddress = '';
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
    const currentId = String(this.currentResultId);
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
    this.#state.selectedFootprintIndex = null;
    this.#state.selectedPoint = {
      id: feature.properties.id,
      name: feature.properties.name,
      coordinates: [...feature.geometry.coordinates]
    };
    this.#state.returnFocusElement = trigger ?? null;
    const properties = feature.properties;
    if (!this.#state.buildingAddressListenerInstalled && this.#map) {
      this.#map.on('idle', this.#refreshBuildingAddress);
      this.#state.buildingAddressListenerInstalled = true;
    }
    this.#state.resolvedBuildingAddress = this.#resolveBuildingAddress(feature);
    this.#renderPlaceCard(feature);
    this.#state.requestedPlace = null;
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

  // A building/address row opens the same point card as tapping its house number. It reveals the result only when it
  // leaves the focus zone, exactly as choosing a place does.
  showSearchResult(result, trigger) {
    if (result.kind === 'place') {
      this.showPlace(result.feature.properties.id, trigger);
      return;
    }
    const feature = {...result.feature, layer: {id: 'building-numbers'}};
    const point = {
      ...this.#context.describePoint(feature, result.coordinates),
      id: result.id
    };
    elementById('search').blur();
    this.showPoint(point, feature, {trigger, reveal: true});
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
      duration: this.#context.prefersReducedMotion ? 0 : selectionCameraDurationMilliseconds,
      retainPadding: false
    });
  }

  // Selection uses the existing details card and original footprint; entrance bounds keep the arrows visible.
  // Search results pass reveal: true so they follow the focus-zone rule instead of recentring on every choice.
  showPoint(point, feature = null, {trigger = null, reveal = false} = {}) {
    this.close(false);
    this.#state.selectedPoint = point;
    this.#state.returnFocusElement = trigger;
    const footprintIndex =
      feature?.layer?.id === 'buildings' ? feature.id : feature?.properties?.footprintIndex;
    this.#state.selectedFootprintIndex = Number.isInteger(footprintIndex) ? footprintIndex : null;
    const buildingFootprints = this.#buildingFootprintsFor(feature);
    renderCardContent(
      buildObjectCard(point, {
        sourceDate: this.#directory.sourceDate,
        placesInside: this.#context.placesInsideFootprint(buildingFootprints, this.#directory.allPlaces)
      })
    );
    elementById('place-card').hidden = false;
    this.#state.requestedPlace = null;
    this.updatePlaceLayers();
    // A map tap leaves search; choosing a row keeps the results beside the card.
    if (!reveal) this.#interface.close();
    this.#interface.placeCardOpened();
    this.#context.onSelectionChanged();
    this.markCurrentResult();
    this.#objectSelection.select(feature, point.coordinates);
    const entrances =
      point.kind === 'Building' ? this.#directory.buildingAddresses.get(footprintIndex)?.entrances : [];
    this.#state.revealOnlyWhenNeeded = reveal;
    const needsReveal =
      reveal &&
      (this.#map.getZoom() < 15 ||
        !isInFocusZone(this.#map.project(point.coordinates), this.#interface.mapArea()));
    if (needsReveal) this.#state.pendingReveal = {zoom: 15};
    if (entrances?.length) {
      this.#state.selectedPoint = {...point, entrances};
      // The fit ends with a moveend, which flushes the reveal after the entrance bounds are known.
      this.frameBuildingEntrances(entrances, point.coordinates);
    } else if (needsReveal) this.flushPendingReveal();
    else if (!reveal) this.focusCoordinates(point.coordinates, this.#map.getZoom());
    elementById('close-place').focus({preventScroll: true});
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
    if (this.#state.revealOnlyWhenNeeded && !this.#state.pendingReveal) return;
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

  // A changed filter can invalidate a selected listing, but never silently select a different one.
  onFilterChanged() {
    const isSelectedPlaceExcluded =
      this.#state.selectedPlace &&
      !this.#directory.filteredPlaces.some(
        feature => feature.properties.id === this.#state.selectedPlace.properties.id
      );
    if (this.#state.isChoosingListing || isSelectedPlaceExcluded) this.close(false);
    this.clearRequestedPlace();
  }

  // Drop the below-threshold icon exception; an explicitly selected listing keeps its own marker.
  clearRequestedPlace() {
    this.#state.requestedPlace = null;
    this.updatePlaceLayers();
  }

  hasExplicitFilter() {
    return Boolean(elementById('search').value.trim()) || this.#directory.activeCategory !== null;
  }
}
