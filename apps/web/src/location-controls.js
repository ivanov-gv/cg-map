import {mapBounds} from '@ivanov-gv/map-core';
import {DISCOVER_ZOOM} from './core.js';
import {elementById} from './dom.js';
import {PositionTracker, positionFeatures} from './position.js';
import {
  FAILED_POSITION_STATES,
  hasUsablePosition,
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
  #lastFollowedCoordinates = null;

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
    // Stop following when the state makes it impossible to continue.
    if (this.#isFollowing && this.#shouldStopFor(state)) {
      this.#stopFollowingWithMessage(snapshot);
    }
    elementById('position-status').textContent = positionStatusText(snapshot, this.#context.hasExploredMap());
    elementById('position-badge').dataset.state = state;
    this.#renderFollowing();
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
    // Retry location when explicitly requested and still acquiring.
    if (this.#isLocationRequested && state === 'acquiring') {
      this.#isLocationRequested = false;
      this.#tracker?.retry();
    }
    if (!this.#map?.getSource('position')) return;
    this.#map.getSource('position').setData(positionFeatures(snapshot));
    // While following, keep the camera on every new usable fix.
    if (this.#isFollowing && hasUsablePosition(state) && fix && this.#isNewFollowFix(fix)) {
      // Clear stale request flag before moving the camera.
      this.#isLocationRequested = false;
      this.#moveCameraToFix(fix);
      return;
    }
    // Center once on the first usable fix, never after the person has started exploring.
    if (
      hasUsablePosition(state) &&
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

  // Updates the data-following attribute on the badge and aria-pressed on the button.
  #renderFollowing() {
    elementById('position-badge').dataset.following = String(this.#isFollowing);
    elementById('position-action').setAttribute('aria-pressed', String(this.#isFollowing));
  }

  // Returns true when the given state should stop following.
  // Only permanent failures stop following: 'denied', 'outside', 'insecure', 'unsupported'.
  // Transient errors ('unavailable', 'timeout') do not stop following, because the tracker
  // retries automatically and a clearWatch() error can briefly set 'unavailable'.
  #shouldStopFor(state) {
    return ['denied', 'outside', 'insecure', 'unsupported'].includes(state);
  }

  // Stops following and notifies the user with the position message.
  #stopFollowingWithMessage(snapshot) {
    this.#isFollowing = false;
    this.#isLocationRequested = false;
    this.#context.notify(positionMessage(snapshot));
    this.#renderFollowing();
  }

  // Returns true when the fix is different from the last one the follower moved to.
  #isNewFollowFix(fix) {
    if (!this.#lastFollowedCoordinates) return true;
    return (
      fix.coordinates[0] !== this.#lastFollowedCoordinates[0] ||
      fix.coordinates[1] !== this.#lastFollowedCoordinates[1]
    );
  }

  // Moves the camera to keep the fix centered, preserving the current zoom and map offset.
  // Tags the move so stopFollowingOnForeignMove can distinguish it from other camera moves.
  #moveCameraToFix(fix, zoom) {
    this.#lastFollowedCoordinates = [...fix.coordinates];
    const offset = this.#interface.mapOffset();
    const targetZoom = zoom ?? this.#map.getZoom();
    this.#map.easeTo(
      {
        center: fix.coordinates,
        zoom: targetZoom,
        offset,
        duration: this.#context.prefersReducedMotion ? 0 : followCameraDurationMilliseconds
      },
      {isLocationFollowMove: true}
    );
  }

  // Toggles location following on click.
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
    this.#isLocationRequested = false;
    this.#renderFollowing();
  }

  // Starts following without a second camera path.
  // Sets hasCenteredOnFix so the one-time first-fix centring never runs after following starts.
  #startFollowing() {
    const {fix, state} = this.#snapshot;
    if (fix && hasUsablePosition(state)) {
      // With a usable fix: close the interface and selection, then move the camera.
      this.#interface.close();
      this.#context.closeSelection();
      this.#isFollowing = true;
      this.#hasCenteredOnFix = true;
      this.#renderFollowing();
      this.#moveCameraToFix(fix, Math.max(this.#map.getZoom(), DISCOVER_ZOOM));
    } else {
      // No usable fix yet — close the interface, mark following, and request a retry.
      // Set #isLocationRequested so the next render will retry or explain.
      // Do not call retry() directly: it stops the existing watch first, which can fire
      // an error callback that sets a failed state and stops following before the new watch starts.
      this.#interface.close();
      this.#context.closeSelection();
      this.#isFollowing = true;
      this.#hasCenteredOnFix = true;
      this.#isLocationRequested = true;
      this.#renderFollowing();
      this.render(this.#snapshot);
    }
  }

  // Stops following on any camera move the follower did not make.
  // The follower tags its own moves with isLocationFollowMove; everything else stops it.
  stopFollowingOnForeignMove(event) {
    if (this.#isFollowing && !event.isLocationFollowMove) {
      this.#stopFollowing();
    }
  }

  // Only an explicit request may retry location or show recovery advice; a usable fix recenters immediately.
  requestPosition() {
    this.#interface.close();
    this.#context.closeSelection();
    if (this.#snapshot.fix && hasUsablePosition(this.#snapshot.state)) {
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
