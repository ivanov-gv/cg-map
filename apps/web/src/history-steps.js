// Pure mapping between the visible UI state and browser history depth.
// openSteps returns ordered steps away from the opening view; stateAfterBack returns
// the UI state one step back so Back and UI closes reach the same state.

export const STEP = Object.freeze({
  SEARCH_BUBBLE: 'search-bubble',
  SEARCH_STRIP: 'search-strip',
  CARD_PEEK: 'card-peek',
  CARD_FULL: 'card-full',
  CARD_FULLSCREEN: 'card-fullscreen',
  DOCK: 'dock',
  FLIP_MODES: 'flip-modes'
});

export function historyMarker(depth) {
  return {depth};
}

export function depthOf(marker) {
  return typeof marker?.depth === 'number' ? marker.depth : null;
}

// UI state:
// {
//   view: 'closed' | 'search' | 'dock',
//   isFlip: boolean, // Flip has no Full step: Fullscreen steps directly back to Peek
//   flipDockScreen: 'list' | 'modes' | null,
//   resultsCompacted: boolean, // true when search bubble is compacted to the strip
//   card: null | { state: 'peek' | 'full' | 'fullscreen', fromDock: boolean }
// }
export function openSteps(state) {
  if (!state) return [];
  const steps = [];
  if (state.view === 'search') {
    steps.push(STEP.SEARCH_BUBBLE);
    if (state.resultsCompacted && !state.card) {
      steps.push(STEP.SEARCH_STRIP);
      return steps;
    }
    if (state.card) appendCardSteps(steps, state.card, {overSearch: true, isFlip: !!state.isFlip});
    return steps;
  }
  if (state.view === 'dock') {
    // A visible dock sits above a card behind it, so the dock is the top step to Back out of.
    if (state.card) appendCardSteps(steps, state.card, {overSearch: false, isFlip: !!state.isFlip});
    steps.push(STEP.DOCK);
    if (state.flipDockScreen === 'modes') steps.push(STEP.FLIP_MODES);
    return steps;
  }
  if (state.card?.fromDock) {
    // A Flip card opened from the dock hides the dock, but its step still sits above it.
    steps.push(STEP.DOCK);
  }
  if (state.card) appendCardSteps(steps, state.card, {overSearch: false, isFlip: !!state.isFlip});
  return steps;
}

function appendCardSteps(steps, card, {overSearch, isFlip}) {
  // A non-Flip card outside search has no Peek step: Back from Full closes it.
  if (overSearch || isFlip || card.state === 'peek') steps.push(STEP.CARD_PEEK);
  if (card.state === 'peek') return;
  steps.push(STEP.CARD_FULL);
  // Flip's expanded card is Fullscreen; it shares the Full step so Back returns to Peek.
  if (card.state === 'fullscreen' && !isFlip) steps.push(STEP.CARD_FULLSCREEN);
}

export function stateAfterBack(state) {
  const steps = openSteps(state);
  if (steps.length === 0) return openingState();
  const top = steps[steps.length - 1];
  switch (top) {
    case STEP.SEARCH_BUBBLE:
      return openingState();
    case STEP.SEARCH_STRIP:
      return {...openingState(), view: 'search'};
    case STEP.CARD_PEEK:
      // Closing a Flip card returns to whatever launched it: dock, search, or the bare map.
      if (state.card?.fromDock) return {...openingState(), view: 'dock', flipDockScreen: 'list'};
      if (state.view === 'search') return {...openingState(), view: 'search'};
      return openingState();
    case STEP.CARD_FULL:
      if (steps.includes(STEP.CARD_PEEK)) return withCardState(state, 'peek');
      return openingState();
    case STEP.CARD_FULLSCREEN:
      return withCardState(state, 'full');
    case STEP.DOCK:
      if (state.view === 'dock' && state.card) {
        // Closing a visible dock uncovers the card behind it; a Peek needs the results that a view change removes.
        const card = {...state.card, state: state.card.state === 'peek' ? 'full' : state.card.state};
        return {...openingState(), card};
      }
      return openingState();
    case STEP.FLIP_MODES:
      return {...openingState(), view: 'dock', flipDockScreen: 'list'};
    default:
      return openingState();
  }
}

function openingState() {
  return {view: 'closed', flipDockScreen: null, resultsCompacted: false, card: null};
}

function withCardState(state, cardState) {
  return {
    ...state,
    card: state.card ? {...state.card, state: cardState} : {state: cardState, fromDock: false}
  };
}
