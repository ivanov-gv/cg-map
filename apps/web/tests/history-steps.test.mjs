import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BASE_MARKER,
  STEP,
  clearSteps,
  closeTopStep,
  createHistorySteps,
  currentDepth,
  depthOf,
  enterStep,
  historyMarker,
  stepBack,
  stepsToCloseForDepth,
  topStep
} from '../src/history-steps.js';

test('opening view has no steps and the base marker is depth 0', () => {
  const history = createHistorySteps();
  assert.equal(currentDepth(history), 0);
  assert.equal(topStep(history), null);
  assert.deepEqual(BASE_MARKER, historyMarker(0));
  assert.equal(depthOf(BASE_MARKER), 0);
  assert.equal(depthOf(null), null);
});

test('entering a step pushes one entry and repeating it does not grow history', () => {
  let history = createHistorySteps();
  let result = enterStep(history, STEP.SEARCH_BUBBLE);
  assert.equal(result.changed, true);
  history = result.state;
  assert.equal(currentDepth(history), 1);
  assert.equal(topStep(history), STEP.SEARCH_BUBBLE);

  result = enterStep(history, STEP.SEARCH_BUBBLE);
  assert.equal(result.changed, false);
  assert.equal(currentDepth(result.state), 1);
});

test('phone card chain: fullscreen to full to peek to closed, then bubble to map', () => {
  let history = createHistorySteps();
  history = enterStep(history, STEP.SEARCH_BUBBLE).state;
  history = enterStep(history, STEP.CARD_PEEK).state;
  history = enterStep(history, STEP.CARD_FULL).state;
  history = enterStep(history, STEP.CARD_FULLSCREEN).state;
  assert.equal(currentDepth(history), 4);

  let back = stepBack(history);
  assert.equal(back.entry.step, STEP.CARD_FULLSCREEN);
  history = back.state;
  back = stepBack(history);
  assert.equal(back.entry.step, STEP.CARD_FULL);
  history = back.state;
  back = stepBack(history);
  assert.equal(back.entry.step, STEP.CARD_PEEK);
  history = back.state;
  assert.equal(topStep(history), STEP.SEARCH_BUBBLE);

  back = stepBack(history);
  assert.equal(back.entry.step, STEP.SEARCH_BUBBLE);
  history = back.state;
  assert.equal(currentDepth(history), 0);
  assert.equal(stepBack(history), null);
});

test('results strip as a standalone step returns to the bubble', () => {
  let history = createHistorySteps();
  history = enterStep(history, STEP.SEARCH_BUBBLE).state;
  history = enterStep(history, STEP.SEARCH_STRIP).state;
  assert.equal(topStep(history), STEP.SEARCH_STRIP);
  const back = stepBack(history);
  assert.equal(back.entry.step, STEP.SEARCH_STRIP);
  assert.equal(topStep(back.state), STEP.SEARCH_BUBBLE);
});

test('dock and Flip modes chain: modes to list to closed', () => {
  let history = createHistorySteps();
  history = enterStep(history, STEP.DOCK).state;
  history = enterStep(history, STEP.FLIP_MODES).state;
  assert.equal(currentDepth(history), 2);

  let back = stepBack(history);
  assert.equal(back.entry.step, STEP.FLIP_MODES);
  history = back.state;
  assert.equal(topStep(history), STEP.DOCK);
  back = stepBack(history);
  assert.equal(back.entry.step, STEP.DOCK);
  assert.equal(currentDepth(back.state), 0);
});

test('closing by UI consumes only the matching top entry', () => {
  let history = enterStep(createHistorySteps(), STEP.DOCK).state;
  let closed = closeTopStep(history, STEP.SEARCH_BUBBLE);
  assert.equal(closed.changed, false);
  assert.equal(currentDepth(closed.state), 1);

  closed = closeTopStep(history, STEP.DOCK);
  assert.equal(closed.changed, true);
  assert.equal(currentDepth(closed.state), 0);

  history = enterStep(createHistorySteps(), STEP.SEARCH_BUBBLE).state;
  history = enterStep(history, STEP.CARD_PEEK).state;
  closed = closeTopStep(history, STEP.CARD_PEEK);
  assert.equal(closed.changed, true);
  assert.equal(topStep(closed.state), STEP.SEARCH_BUBBLE);
});

test('Flip card can remember that closing it should restore the dock', () => {
  let history = createHistorySteps();
  history = enterStep(history, STEP.DOCK).state;
  history = enterStep(history, STEP.CARD_PEEK, {restoreDock: true}).state;
  history = enterStep(history, STEP.CARD_FULL, {restoreDock: true}).state;

  let back = stepBack(history);
  assert.equal(back.entry.step, STEP.CARD_FULL);
  assert.equal(back.entry.meta.restoreDock, true);
  history = back.state;
  back = stepBack(history);
  assert.equal(back.entry.step, STEP.CARD_PEEK);
  assert.equal(back.entry.meta.restoreDock, true);
  assert.equal(topStep(back.state), STEP.DOCK);
});

test('stepsToCloseForDepth tells how many entries Back crossed', () => {
  let history = createHistorySteps();
  history = enterStep(history, STEP.SEARCH_BUBBLE).state;
  history = enterStep(history, STEP.CARD_PEEK).state;
  assert.equal(stepsToCloseForDepth(history, 1), 1);
  assert.equal(stepsToCloseForDepth(history, 0), 2);
  assert.equal(stepsToCloseForDepth(history, 2), 0);
  assert.equal(stepsToCloseForDepth(history, 5), null);
  assert.equal(stepsToCloseForDepth(history, null), null);
});

test('clearSteps returns to the opening view', () => {
  let history = enterStep(createHistorySteps(), STEP.DOCK).state;
  history = enterStep(history, STEP.CARD_PEEK).state;
  const cleared = clearSteps();
  assert.equal(currentDepth(cleared), 0);
  assert.notEqual(history, cleared);
});
