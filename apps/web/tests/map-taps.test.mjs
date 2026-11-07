import test from 'node:test';
import assert from 'node:assert/strict';
import {installMapTaps} from '../src/map-taps.js';
function createEnvironment() {
  const handlers = new Map();
  const timers = new Map();
  const selectedEvents = [];
  let nowMilliseconds = 0;
  let timerId = 0;
  let isMapMoving = false;
  const map = {
    on: (eventType, listener) => handlers.set(eventType, listener),
    off: eventType => handlers.delete(eventType),
    isMoving: () => isMapMoving
  };
  const dispose = installMapTaps(map, event => selectedEvents.push(event), {
    now: () => nowMilliseconds,
    schedule: callback => {
      timers.set(++timerId, callback);
      return timerId;
    },
    cancel: timerId => timers.delete(timerId)
  });
  return {
    handlers,
    timers,
    selected: selectedEvents,
    dispose,
    fire: (eventType, event = {}) => handlers.get(eventType)?.(event),
    advance: () => {
      nowMilliseconds += 501;
      const jobs = [...timers.values()];
      timers.clear();
      jobs.forEach(callback => callback());
    },
    move: () => {
      isMapMoving = true;
    }
  };
}
test('single click selects only after the recognition window', () => {
  const environment = createEnvironment();
  environment.fire('click', {id: 1});
  assert.equal(environment.selected.length, 0);
  environment.advance();
  assert.deepEqual(environment.selected, [{id: 1}]);
});
test('second contact, double click, movement and cancellation suppress point selection', () => {
  for (const gesture of ['touchstart', 'mousedown', 'dblclick', 'movestart', 'touchcancel', 'remove']) {
    const environment = createEnvironment();
    environment.fire('click');
    environment.fire(gesture);
    environment.advance();
    assert.equal(environment.selected.length, 0, gesture);
  }
  const environment = createEnvironment();
  environment.fire('click', {originalEvent: {detail: 2}});
  environment.advance();
  assert.equal(environment.selected.length, 0);
});
test('pending callbacks cannot select while moving; disposal clears listeners and timers', () => {
  const environment = createEnvironment();
  environment.fire('click');
  environment.move();
  environment.advance();
  assert.equal(environment.selected.length, 0);
  environment.dispose();
  assert.equal(environment.handlers.size, 0);
  assert.equal(environment.timers.size, 0);
});
