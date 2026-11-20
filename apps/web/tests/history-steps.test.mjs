import test from 'node:test';
import assert from 'node:assert/strict';
import {STEP, depthOf, historyMarker, openSteps, stateAfterBack} from '../src/history-steps.js';

const opening = {view: 'closed', flipDockScreen: null, resultsCompacted: false, card: null};

test('opening view has no steps', () => {
  assert.deepEqual(openSteps(opening), []);
  assert.deepEqual(stateAfterBack(opening), opening);
  assert.deepEqual(historyMarker(0), {depth: 0});
  assert.deepEqual(historyMarker(2), {depth: 2});
  assert.equal(depthOf({depth: 1}), 1);
  assert.equal(depthOf({}), null);
  assert.equal(depthOf(null), null);
});

test('search bubble is one step and Back closes it', () => {
  const state = {...opening, view: 'search'};
  assert.deepEqual(openSteps(state), [STEP.SEARCH_BUBBLE]);
  assert.deepEqual(stateAfterBack(state), opening);
});

test('compacted results strip is a step above the bubble and Back returns to the bubble', () => {
  const strip = {...opening, view: 'search', resultsCompacted: true};
  assert.deepEqual(openSteps(strip), [STEP.SEARCH_BUBBLE, STEP.SEARCH_STRIP]);
  assert.deepEqual(stateAfterBack(strip), {...opening, view: 'search'});
  assert.deepEqual(stateAfterBack({...opening, view: 'search'}), opening);
});

test('phone card over search steps peek, full, fullscreen', () => {
  const peek = {...opening, view: 'search', card: {state: 'peek', fromDock: false}};
  const full = {...opening, view: 'search', card: {state: 'full', fromDock: false}};
  const fullscreen = {...opening, view: 'search', card: {state: 'fullscreen', fromDock: false}};
  assert.deepEqual(openSteps(peek), [STEP.SEARCH_BUBBLE, STEP.CARD_PEEK]);
  assert.deepEqual(openSteps(full), [STEP.SEARCH_BUBBLE, STEP.CARD_PEEK, STEP.CARD_FULL]);
  assert.deepEqual(openSteps(fullscreen), [
    STEP.SEARCH_BUBBLE,
    STEP.CARD_PEEK,
    STEP.CARD_FULL,
    STEP.CARD_FULLSCREEN
  ]);
  assert.deepEqual(stateAfterBack(fullscreen), full);
  assert.deepEqual(stateAfterBack(full), peek);
  assert.deepEqual(stateAfterBack(peek), {...opening, view: 'search'});
  assert.deepEqual(stateAfterBack({...opening, view: 'search'}), opening);
});

test('map-tap card has no Peek step: Back from Full closes it', () => {
  const full = {...opening, card: {state: 'full', fromDock: false}};
  const fullscreen = {...opening, card: {state: 'fullscreen', fromDock: false}};
  assert.deepEqual(openSteps(full), [STEP.CARD_FULL]);
  assert.deepEqual(openSteps(fullscreen), [STEP.CARD_FULL, STEP.CARD_FULLSCREEN]);
  assert.deepEqual(stateAfterBack(fullscreen), full);
  assert.deepEqual(stateAfterBack(full), opening);
});

test('dock and Flip modes chain', () => {
  const dock = {...opening, view: 'dock', flipDockScreen: 'list'};
  const modes = {...opening, view: 'dock', flipDockScreen: 'modes'};
  assert.deepEqual(openSteps(dock), [STEP.DOCK]);
  assert.deepEqual(openSteps(modes), [STEP.DOCK, STEP.FLIP_MODES]);
  assert.deepEqual(stateAfterBack(modes), dock);
  assert.deepEqual(stateAfterBack(dock), opening);
});

test('Flip card opened from dock returns to dock when the card closes', () => {
  const peek = {
    ...opening,
    view: 'search',
    card: {state: 'peek', fromDock: true}
  };
  const full = {
    ...opening,
    view: 'search',
    card: {state: 'full', fromDock: true}
  };
  assert.deepEqual(openSteps(full), [STEP.SEARCH_BUBBLE, STEP.CARD_PEEK, STEP.CARD_FULL]);
  assert.deepEqual(stateAfterBack(full), peek);
  assert.deepEqual(stateAfterBack(peek), {...opening, view: 'dock', flipDockScreen: 'list'});
});

test('Flip card steps backs from Fullscreen to Peek and then to its own origin', () => {
  const mapPeek = {...opening, isFlip: true, card: {state: 'peek', fromDock: false}};
  const mapFullscreen = {...mapPeek, card: {state: 'fullscreen', fromDock: false}};
  const dockPeek = {...opening, isFlip: true, card: {state: 'peek', fromDock: true}};

  assert.deepEqual(openSteps(mapPeek), [STEP.CARD_PEEK]);
  assert.deepEqual(openSteps(mapFullscreen), [STEP.CARD_PEEK, STEP.CARD_FULL]);
  assert.deepEqual(stateAfterBack(mapFullscreen), mapPeek);
  assert.deepEqual(stateAfterBack(mapPeek), opening);

  assert.deepEqual(openSteps(dockPeek), [STEP.DOCK, STEP.CARD_PEEK]);
  assert.deepEqual(stateAfterBack(dockPeek), {...opening, view: 'dock', flipDockScreen: 'list'});
});
