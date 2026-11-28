import test from 'node:test';
import assert from 'node:assert/strict';
import {
  flipCardActionAfterPull,
  flipCardDragFrame,
  flipCardStateAfterClose,
  flipCardStateAfterTap
} from './interface.js';

test('a tap opens Flip Fullscreen only from Peek', () => {
  assert.equal(flipCardStateAfterTap('peek'), 'fullscreen');
  assert.equal(flipCardStateAfterTap('fullscreen'), 'fullscreen');
  assert.equal(flipCardStateAfterTap('full'), 'full');
});

test('the Flip Icon Button steps from Fullscreen back to Peek, then closes', () => {
  assert.equal(flipCardStateAfterClose('fullscreen'), 'peek');
  assert.equal(flipCardStateAfterClose('peek'), 'closed');
  assert.equal(flipCardStateAfterClose('full'), 'closed');
});

test('a Flip pull asks for the same two card steps as the buttons', () => {
  assert.equal(flipCardActionAfterPull({state: 'peek', deltaYPixels: -120, velocityPixelsPerMillisecond: 0}), 'open');
  assert.equal(flipCardActionAfterPull({state: 'peek', deltaYPixels: -20, velocityPixelsPerMillisecond: -0.8}), 'open');
  assert.equal(flipCardActionAfterPull({state: 'peek', deltaYPixels: 120, velocityPixelsPerMillisecond: 0}), 'back');
  assert.equal(flipCardActionAfterPull({state: 'fullscreen', deltaYPixels: 120, velocityPixelsPerMillisecond: 0}), 'back');
  assert.equal(
    flipCardActionAfterPull({state: 'fullscreen', deltaYPixels: 120, velocityPixelsPerMillisecond: 0.8}),
    'back'
  );
  // A flick in the opposite direction wins over the net travel, as it does on a phone.
  assert.equal(flipCardActionAfterPull({state: 'peek', deltaYPixels: -120, velocityPixelsPerMillisecond: 0.8}), 'back');
  assert.equal(flipCardActionAfterPull({state: 'peek', deltaYPixels: 120, velocityPixelsPerMillisecond: -0.8}), 'open');
  // Neither a small movement nor a pull above Fullscreen has a step to take.
  assert.equal(flipCardActionAfterPull({state: 'peek', deltaYPixels: -20, velocityPixelsPerMillisecond: 0}), null);
  assert.equal(flipCardActionAfterPull({state: 'fullscreen', deltaYPixels: -120, velocityPixelsPerMillisecond: 0}), null);
});

test('a Flip pull frame interpolates the same Peek and Fullscreen steps', () => {
  const steps = {
    peek: {top: 168, height: 60, bottom: 228, inset: 12},
    fullscreen: {top: 0, height: 240, bottom: 240, inset: 0},
    closed: {top: 228, height: 0, bottom: 228, inset: 12}
  };
  const frame = (state, deltaYPixels) => flipCardDragFrame({state, deltaYPixels, steps});

  const opening = frame('peek', -84);
  assert.equal(opening.targetState, 'fullscreen');
  assert.deepEqual(opening.rect, {top: 84, height: 150, bottom: 234, inset: 6});

  const steppingBack = frame('fullscreen', 84);
  assert.equal(steppingBack.targetState, 'peek');
  assert.deepEqual(steppingBack.rect, {top: 84, height: 150, bottom: 234, inset: 6});

  const closing = frame('peek', 30);
  assert.equal(closing.targetState, 'closed');
  assert.deepEqual(closing.rect, {top: 198, height: 30, bottom: 228, inset: 12});

  assert.equal(frame('fullscreen', -84), null);
});
