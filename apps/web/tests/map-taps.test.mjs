import test from 'node:test';
import assert from 'node:assert/strict';
import {installMapTaps} from '../src/map-taps.js';

const pastTapWindowMilliseconds = 501;

// A fake map and clock. advance() moves past the tap window and runs every pending timer.
function setup() {
  const handlers = new Map();
  const timers = new Map();
  const selected = [];
  let time = 0;
  let nextTimerId = 0;
  let isMoving = false;
  const map = {
    on: (type, handler) => handlers.set(type, handler),
    off: type => handlers.delete(type),
    isMoving: () => isMoving
  };
  const dispose = installMapTaps(map, event => selected.push(event), {
    now: () => time,
    schedule: callback => {
      nextTimerId++;
      timers.set(nextTimerId, callback);
      return nextTimerId;
    },
    cancel: timerId => timers.delete(timerId)
  });
  return {
    handlers,
    timers,
    selected,
    dispose,
    fire: (type, event = {}) => handlers.get(type)?.(event),
    advance: () => {
      time += pastTapWindowMilliseconds;
      const callbacks = [...timers.values()];
      timers.clear();
      for (const callback of callbacks) callback();
    },
    startMoving: () => {
      isMoving = true;
    }
  };
}

test('single click selects only after the recognition window', () => {
  const taps = setup();
  taps.fire('click', {id: 1});
  assert.equal(taps.selected.length, 0);
  taps.advance();
  assert.deepEqual(taps.selected, [{id: 1}]);
});

test('second contact, double click, movement and cancellation suppress point selection', () => {
  for (const gesture of ['touchstart', 'mousedown', 'dblclick', 'movestart', 'touchcancel', 'remove']) {
    const taps = setup();
    taps.fire('click');
    taps.fire(gesture);
    taps.advance();
    assert.equal(taps.selected.length, 0, gesture);
  }
  const taps = setup();
  taps.fire('click', {originalEvent: {detail: 2}});
  taps.advance();
  assert.equal(taps.selected.length, 0);
});

test('pending callbacks cannot select while moving; disposal clears listeners and timers', () => {
  const taps = setup();
  taps.fire('click');
  taps.startMoving();
  taps.advance();
  assert.equal(taps.selected.length, 0);
  taps.dispose();
  assert.equal(taps.handlers.size, 0);
  assert.equal(taps.timers.size, 0);
});
