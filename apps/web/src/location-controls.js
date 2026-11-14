import {mapBounds} from '@ivanov-gv/map-core';
import {DISCOVER_ZOOM, isUserCameraEvent} from './core.js';
import {elementById} from './dom.js';
import {PositionTracker, positionFeatures} from './position.js';
import {
  FAILED_POSITION_STATES,
  positionActionLabel,
  positionIndicator,
  positionMessage,
  positionStatusText
} from './status-messages.js';

const firstFixCameraDurationMilliseconds = 600;
const requestedFixCameraDurationMilliseconds = 500;
const followCameraDurationMilliseconds = 400;

// Owns the in-memory fix, explicit location requests, first-fix recentering, and location following.
// Map exploration belongs to the app; its getter prevents a later fix from overriding a camera the person already moved.
export class LocationControls {
  #context;
  #snapshot = {state: 'idle', fix: null, age: null};
  #tracker = null;
  #isLocationRequested = false;
  #hasCenteredOnFix = false;
  #isFollowing = false;

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
  get isFollowing() {
    return this.#isFollowing;
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
    // Stop following if location becomes unavailable while following.
    if (this.#isFollowing && FAILED_POSITION_STATES.includes(state)) {
      this.#isFollowing = false;
    }
    elementById('position-status').textContent = positionStatusText(snapshot, this.#context.hasExploredMap());
    elementById('position-badge').dataset.state = state;
    this.#renderFollowing();
    const action = positionActionLabel(state, this.#isFollowing);
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
    // While following, keep the camera on every new usable fix.
    if (this.#isFollowing && ['live', 'approximate'].includes(state) && fix) {
      this.#moveCameraToFix(fix);
      return;
    }
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
        duration: this.#context.prefersReducedMotion ? 0 : firstFixCameraDurationMilliseconds
      });
    }
  }

  // Updates the data-following attribute and aria-pressed on the position button.
  #renderFollowing() {
    elementById('position-badge').dataset.following = String(this.#isFollowing);
    elementById('position-action').setAttribute('aria-pressed', String(this.#isFollowing));
  }

  // Moves the camera to keep the fix centered, preserving the current zoom and map offset.
  #moveCameraToFix(fix) {
    const offset = this.#interface.mapOffset();
    this.#context.onAutomaticCameraMove();
    this.#map.easeTo({
      center: fix.coordinates,
      offset,
      duration: this.#context.prefersReducedMotion ? 0 : followCameraDurationMilliseconds
    });
  }

  // Toggles location following on click. Always sets the flag; delegates camera work.
  toggleFollowing() {
    if (this.#isFollowing) {
      this.#stopFollowing();
      return;
    }
    this.#startFollowing();
  }

  // Stops following and updates the UI.
  #stopFollowing() {
    this.#isFollowing = false;
    this.#renderFollowing();
  }

  // Starts following: sets the flag, renders it, then delegates to requestPosition.
  #startFollowing() {
    this.#isFollowing = true;
    this.#hasCenteredOnFix = true;
    this.#renderFollowing();
    this.requestPosition();
  }

  // Stops following when the user moves the map. Only user gestures (with originalEvent) count.
  onCameraEvent(event) {
    if (this.#isFollowing && isUserCameraEvent(event)) {
      this.#isFollowing = false;
      this.#renderFollowing();
    }
  }

  // Only an explicit request may retry location or show recovery advice; a usable fix recenters immediately.
  requestPosition() {
    this.#interface.close();
    this.#context.closeSelection();
    if (this.#snapshot.fix && ['live', 'approximate'].includes(this.#snapshot.state)) {
      this.#context.focusCoordinates(
        this.#snapshot.fix.coordinates,
        DISCOVER_ZOOM,
        requestedFixCameraDurationMilliseconds
      );
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
