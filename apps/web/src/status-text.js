// What the transport and location status lines say. Pure: no DOM, storage or network.
import {POSITION_APPROXIMATE_METRES, formatAge} from './core.js';

const checkedTimeFormat = {hour: '2-digit', minute: '2-digit', second: '2-digit'};

// The live transport line for one feed state; fetchedAt is the feed's own ISO time, when it has one.
export function transportStatusText({state, count, fetchedAt}) {
  const checked = fetchedAt ? new Date(fetchedAt).toLocaleTimeString([], checkedTimeFormat) : '';
  const busPositions = `${count} bus position${count === 1 ? '' : 's'}`;
  const messages = {
    off: 'Transport off',
    loading: 'Loading live buses…',
    live: count ? `${busPositions} · checked ${checked}` : `No buses reported · checked ${checked}`,
    stale: `Updates delayed · last checked ${checked}`,
    unavailable: 'Live buses temporarily unavailable · retrying',
    offline: 'Live buses need an internet connection',
    paused: 'Bus updates paused while map is hidden'
  };
  return messages[state] ?? messages.unavailable;
}

// States with a fix good enough to centre the map on.
export const USABLE_POSITION_STATES = ['live', 'approximate'];
// States the person must act on after asking for their location; each becomes a visible error.
export const FAILED_POSITION_STATES = ['denied', 'unavailable', 'timeout', 'outside', 'insecure', 'unsupported'];
// States that always carry a fix inside the map, so the status already explains where the person is.
const LOCATED_POSITION_STATES = ['live', 'approximate', 'stale'];

export function hasUsablePosition(state) {
  return USABLE_POSITION_STATES.includes(state);
}

// The location condition alone, for the status line and for errors. snapshot is PositionTracker's.
export function positionMessage({state, fix, age}) {
  const accuracy = fix ? `±${Math.round(fix.accuracy)} m` : '';
  const messages = {
    idle: 'Checking location…',
    insecure: 'Location needs a secure (HTTPS) page',
    unsupported: 'This browser cannot share location',
    prompt: 'Allow location to see where you are',
    acquiring: 'Finding your location…',
    live: `You are here · ${accuracy}`,
    approximate: `Approximate location · ${accuracy} (over ${POSITION_APPROXIMATE_METRES} m)`,
    stale: `Location not updating · last fix ${formatAge(age ?? 0)} ago`,
    denied: 'Location blocked in browser settings',
    unavailable: 'Location unavailable · check device settings',
    timeout: 'No location fix within 15 s',
    outside: 'You are outside the map (Montenegro)'
  };
  return messages[state] ?? messages.unavailable;
}

// D-06: the status always names the location condition. Until the person explores, a map with no fix inside it shows
// the default view, and the status says so.
export function positionStatusText(snapshot, hasExplored) {
  const {state, fix} = snapshot;
  const hasFixInsideMap = fix && state !== 'outside';
  const isDefaultView = !hasExplored && !hasFixInsideMap && !LOCATED_POSITION_STATES.includes(state);
  return positionMessage(snapshot) + (isDefaultView ? ' · default view: Podgorica' : '');
}

// The badge's symbol: nothing for a live fix, '!' for any problem.
export function positionIndicator(state) {
  const indicators = {idle: '…', prompt: '?', acquiring: '…', approximate: '≈', stale: '◷', live: ''};
  return indicators[state] ?? '!';
}

export function positionActionLabel(state) {
  return hasUsablePosition(state) ? 'Recenter on your location' : 'Locate me';
}
