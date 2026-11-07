import {mapBounds} from '@ivanov-gv/map-core';
import {DISCOVER_ZOOM} from './core.js';
import {elementById} from './dom.js';
import {PositionTracker, positionFeatures} from './position.js';
import {
  FAILED_POSITION_STATES,
  positionActionLabel,
  positionIndicator,
  positionMessage,
  positionStatusText
} from './status-messages.js';

// Owns the in-memory fix, explicit location requests and first-fix recentering. Map exploration belongs
// to the app; its getter prevents a later fix from overriding a camera the person already moved.
export class LocationControls {
  #context;
  #snapshot = {state: 'idle', fix: null, age: null};
  #tracker = null;
  #isLocationRequested = false;
  #hasCenteredOnFix = false;

  constructor(context) {
    this.#context = context;
  }
  get #map() {
    return this.#context.map();
  }
  get #interface() {
    return this.#context.interface();
  }
  get state() {
    return this.#snapshot.state;
  }

  // Location starts independently of directory data and map loading, and cannot block either.
  start() {
    this.#tracker = new PositionTracker({bounds: mapBounds, onChange: snapshot => this.render(snapshot)});
    this.#tracker.start().catch(error => {
      console.error('Location setup failed', error);
      this.render({state: 'unavailable', fix: null, age: null});
    });
  }

  // Reapply the current fix after its map layers load or the default-view explanation changes.
  refresh() {
    this.render(this.#snapshot);
  }

  // D-06: every visible state names its location condition; no fix means the camera is a fallback view.
  render(snapshot) {
    this.#snapshot = snapshot;
    const {state, fix} = snapshot;
    elementById('position-status').textContent = positionStatusText(snapshot, this.#context.hasExploredMap());
    elementById('position-badge').dataset.state = state;
    const action = positionActionLabel(state);
    elementById('position-action').setAttribute(
      'aria-label',
      action + '. ' + elementById('position-status').textContent
    );
    elementById('position-action').title = elementById('position-status').textContent;
    elementById('position-indicator').textContent = positionIndicator(state);
    if (this.#isLocationRequested && FAILED_POSITION_STATES.includes(state)) {
      this.#context.notify(positionMessage(snapshot));
      this.#isLocationRequested = false;
    }
    if (this.#isLocationRequested && state === 'stale' && this.#tracker?.error) {
      this.#context.notify('Location is not updating. Check device location settings and try again.');
      this.#isLocationRequested = false;
    }
    if (!this.#map?.getSource('position')) return;
    this.#map.getSource('position').setData(positionFeatures(snapshot));
    // Center once on the first usable fix, never after the person has started exploring.
    if (
      ['live', 'approximate'].includes(state) &&
      ((!this.#hasCenteredOnFix && !this.#context.hasExploredMap()) || this.#isLocationRequested)
    ) {
      const offset = this.#isLocationRequested ? this.#interface.mapOffset() : [0, 0];
      this.#hasCenteredOnFix = true;
      this.#isLocationRequested = false;
      this.#context.onAutomaticCameraMove();
      this.#map.easeTo({
        center: fix.coordinates,
        zoom: Math.max(this.#map.getZoom(), DISCOVER_ZOOM),
        offset,
        duration: this.#context.prefersReducedMotion ? 0 : 600
      });
    }
  }
  // Only an explicit request may retry location or show recovery advice; a usable fix recenters immediately.
  requestPosition() {
    this.#interface.close();
    this.#context.closeSelection();
    if (this.#snapshot.fix && ['live', 'approximate'].includes(this.#snapshot.state)) {
      this.#context.focusCoordinates(this.#snapshot.fix.coordinates, DISCOVER_ZOOM, 500);
      return;
    }
    this.#isLocationRequested = true;
    if (['denied', 'outside', 'insecure', 'unsupported'].includes(this.#snapshot.state)) {
      this.render(this.#snapshot);
      return;
    }
    this.#tracker?.retry();
  }
}
