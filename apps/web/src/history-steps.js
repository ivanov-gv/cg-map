// Pure mapping between overlay steps and browser history entries.
// Each move away from the opening view pushes one entry; a close by UI or Back consumes it.

export const STEP = {
  DOCK: 'dock',
  FLIP_MODES: 'flip-modes',
  SEARCH_BUBBLE: 'search-bubble',
  SEARCH_STRIP: 'search-strip',
  CARD_PEEK: 'card-peek',
  CARD_FULL: 'card-full',
  CARD_FULLSCREEN: 'card-fullscreen'
};

export const BASE_MARKER = {kompasHistory: 0};

export function historyMarker(depth) {
  return {kompasHistory: depth};
}

export function depthOf(marker) {
  return typeof marker?.kompasHistory === 'number' ? marker.kompasHistory : null;
}

export function createHistorySteps() {
  return {entries: []};
}

export function currentDepth(state) {
  return state.entries.length;
}

export function topEntry(state) {
  return state.entries[state.entries.length - 1] ?? null;
}

export function topStep(state) {
  return topEntry(state)?.step ?? null;
}

// Pushes one step away from the opening view. Does nothing when that step is already on top.
export function enterStep(state, step, meta = {}) {
  if (topStep(state) === step) return {state, changed: false};
  return {
    state: {entries: [...state.entries, {step, meta}]},
    changed: true
  };
}

// Pops the top step: the state reached by Back. Returns null when already at the opening view.
export function stepBack(state) {
  if (state.entries.length === 0) return null;
  const entry = state.entries[state.entries.length - 1];
  return {
    state: {entries: state.entries.slice(0, -1)},
    entry
  };
}

// Removes the top step when it matches, for a close performed by UI that must consume its history entry.
export function closeTopStep(state, step) {
  if (topStep(state) !== step) return {state, changed: false};
  return {state: {entries: state.entries.slice(0, -1)}, changed: true};
}

// Replaces metadata on the top step without changing depth (e.g. remembering origin).
export function updateTopMeta(state, meta) {
  if (state.entries.length === 0) return state;
  const entries = state.entries.slice();
  entries[entries.length - 1] = {...entries[entries.length - 1], meta: {...entries[entries.length - 1].meta, ...meta}};
  return {entries};
}

// Clears every step, for a jump straight to the opening view.
export function clearSteps() {
  return createHistorySteps();
}

// Finds how many top entries to close so that Back lands on the given history depth.
export function stepsToCloseForDepth(state, depth) {
  const current = currentDepth(state);
  if (depth === null || depth < 0 || depth > current) return null;
  return current - depth;
}
