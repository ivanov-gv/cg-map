import test from 'node:test';
import assert from 'node:assert/strict';
import {flipCardStateAfterClose, flipCardStateAfterTap} from '../src/interface.js';

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
