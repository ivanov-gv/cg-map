import test from 'node:test';
import assert from 'node:assert/strict';
import {LocationControls} from '../src/location-controls.js';

const FIRST_COORDINATES = [19.2627, 42.4411];
const SECOND_COORDINATES = [19.2727, 42.4511];

const liveFix = coordinates => ({state: 'live', fix: {coordinates, accuracy: 18}, age: 0});

function createHarness({hasExploredMap = true} = {}) {
  const elements = new Map();
  globalThis.document = {
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, {dataset: {}, attributes: new Map(), textContent: '', setAttribute(name, value) {
          this.attributes.set(name, value);
        }});
      }
      return elements.get(id);
    }
  };

  const moves = [];
  const closed = [];
  const notifications = [];
  const map = {
    getSource: () => ({setData() {}}),
    getZoom: () => 16,
    easeTo(options, metadata) {
      moves.push({options, metadata});
    }
  };
  const interfaceStub = {
    mapOffset: () => [0, 0],
    close() {
      closed.push('interface');
    }
  };
  const context = {
    map: () => map,
    interface: () => interfaceStub,
    hasExploredMap: () => hasExploredMap,
    closeSelection() {
      closed.push('selection');
    },
    notify(message) {
      notifications.push(message);
    },
    prefersReducedMotion: true
  };
  return {
    controls: new LocationControls(context),
    badge: globalThis.document.getElementById('position-badge'),
    action: globalThis.document.getElementById('position-action'),
    moves,
    closed,
    notifications
  };
}

function assertPressed(harness, isFollowing) {
  assert.equal(harness.controls.isFollowing, isFollowing);
  assert.equal(harness.badge.dataset.following, String(isFollowing));
  assert.equal(harness.action.attributes.get('aria-pressed'), String(isFollowing));
}

test('starting with a usable fix follows that fix and closes the open panels', () => {
  const harness = createHarness();
  harness.controls.render(liveFix(FIRST_COORDINATES));

  harness.controls.toggleFollowing();

  assertPressed(harness, true);
  assert.deepEqual(harness.closed, ['interface', 'selection']);
  assert.equal(harness.moves.length, 1);
  assert.deepEqual(harness.moves[0].options.center, FIRST_COORDINATES);
  assert.deepEqual(harness.moves[0].metadata, {isLocationFollowMove: true});
});

test('only a new fix moves the camera while following', () => {
  const harness = createHarness();
  harness.controls.render(liveFix(FIRST_COORDINATES));
  harness.controls.toggleFollowing();

  harness.controls.render(liveFix(SECOND_COORDINATES));
  harness.controls.render(liveFix(SECOND_COORDINATES));

  assert.deepEqual(
    harness.moves.map(move => move.options.center),
    [FIRST_COORDINATES, SECOND_COORDINATES]
  );
});

test('a second click stops following and later fixes hold the camera', () => {
  const harness = createHarness();
  harness.controls.render(liveFix(FIRST_COORDINATES));
  harness.controls.toggleFollowing();
  harness.controls.toggleFollowing();

  harness.controls.render(liveFix(SECOND_COORDINATES));

  assertPressed(harness, false);
  assert.deepEqual(harness.moves.map(move => move.options.center), [FIRST_COORDINATES]);
});

test('a foreign camera move stops following, but a follow move does not', async () => {
  const harness = createHarness();
  harness.controls.render(liveFix(FIRST_COORDINATES));
  harness.controls.toggleFollowing();

  harness.controls.noteCameraMoveStart({isLocationFollowMove: true});
  await Promise.resolve();
  assertPressed(harness, true);

  harness.controls.noteCameraMoveStart({});
  await Promise.resolve();
  assertPressed(harness, false);
});

test('a resize cancels a pending foreign camera move', async () => {
  const harness = createHarness();
  harness.controls.render(liveFix(FIRST_COORDINATES));
  harness.controls.toggleFollowing();

  harness.controls.noteCameraMoveStart({});
  harness.controls.noteMapResize();
  await Promise.resolve();

  assertPressed(harness, true);
});

test('following can start before the first fix and centres on that fix when it arrives', () => {
  const harness = createHarness({hasExploredMap: false});
  harness.controls.render({state: 'acquiring', fix: null, age: null});

  harness.controls.toggleFollowing();

  assertPressed(harness, true);
  assert.deepEqual(harness.closed, ['interface', 'selection']);
  assert.equal(harness.moves.length, 0);

  harness.controls.render(liveFix(FIRST_COORDINATES));

  assertPressed(harness, true);
  assert.deepEqual(harness.moves.map(move => move.options.center), [FIRST_COORDINATES]);
});

test('restarting with the same coordinates clears the last followed fix', () => {
  const harness = createHarness();
  harness.controls.render(liveFix(FIRST_COORDINATES));
  harness.controls.toggleFollowing();
  harness.controls.toggleFollowing();
  harness.controls.render({
    state: 'stale',
    fix: {coordinates: FIRST_COORDINATES, accuracy: 18},
    age: 31_000
  });

  harness.controls.toggleFollowing();
  harness.controls.render(liveFix(FIRST_COORDINATES));

  assertPressed(harness, true);
  assert.deepEqual(harness.moves.map(move => move.options.center), [FIRST_COORDINATES, FIRST_COORDINATES]);
});

test('a failed fix stops following and explains why', () => {
  const harness = createHarness();
  harness.controls.render(liveFix(FIRST_COORDINATES));
  harness.controls.toggleFollowing();

  harness.controls.render({state: 'denied', fix: null, age: null});

  assertPressed(harness, false);
  assert.deepEqual(harness.notifications, ['Location blocked in browser settings']);
});
