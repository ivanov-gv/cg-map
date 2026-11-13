import test from 'node:test';
import assert from 'node:assert/strict';
import {isUserCameraEvent} from '../src/follow-camera.js';

test('isUserCameraEvent returns true when originalEvent is present', () => {
  const userEvent = {originalEvent: {type: 'mousedown'}};
  assert.equal(isUserCameraEvent(userEvent), true);
});

test('isUserCameraEvent returns false when originalEvent is missing', () => {
  const appEvent = {};
  assert.equal(isUserCameraEvent(appEvent), false);
});

test('isUserCameraEvent returns false for undefined originalEvent', () => {
  const explicitEvent = {originalEvent: undefined};
  assert.equal(isUserCameraEvent(explicitEvent), false);
});

test('isUserCameraEvent handles touch and wheel original events', () => {
  assert.equal(isUserCameraEvent({originalEvent: {type: 'touchstart'}}), true);
  assert.equal(isUserCameraEvent({originalEvent: {type: 'wheel'}}), true);
});
