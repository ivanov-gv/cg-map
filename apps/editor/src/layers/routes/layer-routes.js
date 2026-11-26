// Lines as stops in order for each direction. The way between them is drawn along the streets; turn points force it
// through one.
import {createElementWithText} from '../../shared/dom.js';
import {RoadNetwork} from '../roads/road-paths.js';
import {isTurnPoint, lineEdits, movedStop, reversedStops} from './route-stops.js';

const routesFile = 'transit-routes.json';
const stopsFile = 'transport-stops.geojson';
const roadsFile = 'roads.geojson';
const defaultColour = '#1b75bb';
let knownNetwork = null;

// Roads rarely change while a line is edited, and the network is only for drawing.
function networkOf(context) {
  const changeCount = context.session.changes(roadsFile).length;
  if (knownNetwork?.changeCount !== changeCount) {
    const roads = context.entriesOf(roadsFile).map(({feature}) => feature);
    knownNetwork = {changeCount, network: new RoadNetwork(roads)};
  }
  return knownNetwork.network;
}

const stopEntry = (stopId, context) =>
  context.entriesOf(stopsFile).find(({feature}) => feature.properties.stopId === stopId);

function stopPosition(stop, context) {
  if (isTurnPoint(stop)) return stop.turn;
  if (typeof stop !== 'string') return stop.coordinates;
  return stopEntry(stop, context)?.feature.geometry.coordinates ?? null;
}

function stopName(stop, context) {
  if (isTurnPoint(stop)) return 'Turn · not a stop';
  if (typeof stop !== 'string') return stop.name || 'Unnamed stop';
  return stopEntry(stop, context)?.feature.properties.name ?? `Stop ${stop}`;
}

// The way of one direction along the streets, as far as its stops are known.
export function directionPath(stops, context) {
  const positions = stops.map(stop => stopPosition(stop, context)).filter(Boolean);
  const network = networkOf(context);
  return positions.slice(1).flatMap((position, index) => network.pathBetween(positions[index], position));
}

const directionsOf = ({properties}) => properties.directions ?? [];
const shownDirectionIndex = edit => Math.min(edit.extras.direction ?? 0, Math.max(0, directionsOf(edit.feature).length - 1));

// Changes the shown direction and draws the line again.
function changeDirection(edit, change) {
  const index = shownDirectionIndex(edit);
  const directions = directionsOf(edit.feature).map((direction, position) =>
    position === index ? {...direction, ...change(direction)} : direction
  );
  edit.setProperties({directions});
}

const changeStops = (edit, change) => changeDirection(edit, ({stops}) => ({stops: change(stops)}));

function smallButton(label, accessibleName, run, isDisabled = false) {
  const button = createElementWithText('button', label);
  button.type = 'button';
  button.setAttribute('aria-label', accessibleName);
  button.disabled = isDisabled;
  button.onclick = run;
  return button;
}

// A row can be dragged to another place, and moved with its buttons from the keyboard.
function installRowDragging(row, index, edit) {
  row.draggable = true;
  row.ondragstart = event => event.dataTransfer.setData('text/plain', String(index));
  row.ondragover = event => event.preventDefault();
  row.ondrop = event => {
    event.preventDefault();
    const from = Number(event.dataTransfer.getData('text/plain'));
    if (Number.isInteger(from) && from !== index) changeStops(edit, stops => movedStop(stops, from, index));
  };
}

function stopRow(stop, index, stops, edit) {
  const {context} = edit;
  const row = document.createElement('li');
  row.className = isTurnPoint(stop) ? 'route-stop route-turn' : 'route-stop';
  const number = stops.slice(0, index + 1).filter(other => !isTurnPoint(other)).length;
  const name = stopName(stop, context);
  const label = createElementWithText('span', isTurnPoint(stop) ? name : `${number} · ${name}`);
  row.append(label);
  if (context.isPhone()) return row;
  installRowDragging(row, index, edit);
  row.append(
    smallButton('↑', `Move ${name} up`, () => changeStops(edit, list => movedStop(list, index, index - 1)), index === 0),
    smallButton(
      '↓',
      `Move ${name} down`,
      () => changeStops(edit, list => movedStop(list, index, index + 1)),
      index === stops.length - 1
    ),
    smallButton('×', `Remove ${name}`, () => changeStops(edit, list => list.toSpliced(index, 1)))
  );
  return row;
}

// Stops are added one after another until someone is done.
async function addStops(edit, editNow) {
  while (edit.isOpen()) {
    const {stops: currentStops} = directionsOf(editNow().feature)[shownDirectionIndex(editNow())];
    const count = currentStops.filter(stop => !isTurnPoint(stop)).length;
    const picked = await edit.context.pick(stopsFile, `Click stops in the order the line serves them · ${count}`, 'Done');
    if (!picked || !edit.isOpen()) return;
    changeStops(editNow(), stops => [...stops, picked.feature.properties.stopId]);
  }
}

async function addTurn(edit, editNow) {
  const coordinate = await edit.context.pickPoint('Click the street the line must take');
  if (!coordinate || !edit.isOpen()) return;
  // Between the two stops whose way it bends least.
  changeStops(editNow(), stops => {
    const positions = stops.map(stop => stopPosition(stop, edit.context));
    return stops.toSpliced(turnIndex(positions, coordinate), 0, {turn: coordinate});
  });
}

// Where a turn point makes the line longest the least.
export function turnIndex(positions, coordinate) {
  let best = {index: positions.length, detour: Infinity};
  for (let index = 1; index < positions.length; index += 1) {
    const [from, to] = [positions[index - 1], positions[index]];
    if (!from || !to) continue;
    const length = (first, second) => Math.hypot(second[0] - first[0], second[1] - first[1]);
    const detour = length(from, coordinate) + length(coordinate, to) - length(from, to);
    if (detour < best.detour) best = {index, detour};
  }
  return best.index;
}

function directionTabs(edit) {
  const row = document.createElement('div');
  row.className = 'button-row';
  const shownIndex = shownDirectionIndex(edit);
  directionsOf(edit.feature).forEach(({headsign, stops}, index) => {
    const lastStop = stops.findLast(stop => !isTurnPoint(stop));
    const fallback = lastStop ? `To ${stopName(lastStop, edit.context)}` : `Direction ${index + 1}`;
    const tab = createElementWithText('button', headsign || fallback);
    tab.type = 'button';
    tab.setAttribute('aria-pressed', String(index === shownIndex));
    tab.onclick = () => edit.setExtras({direction: index});
    row.append(tab);
  });
  return row;
}

// The stops of the other direction in reverse, as a place to start from.
function copyFromOther(edit) {
  const directions = directionsOf(edit.feature);
  const shownIndex = shownDirectionIndex(edit);
  const isOnlyDirection = directions.length === 1;
  const source = isOnlyDirection ? directions[0] : directions[(shownIndex + 1) % directions.length];
  const copied = {headsign: '', stops: reversedStops(source.stops)};
  const next = isOnlyDirection
    ? [...directions, copied]
    : directions.map((direction, index) => (index === shownIndex ? {...direction, stops: copied.stops} : direction));
  edit.setProperties({directions: next});
  if (isOnlyDirection) edit.latest().setExtras({direction: 1});
}

function directionActions(edit) {
  const row = document.createElement('div');
  row.className = 'button-row';
  const action = (label, run) => {
    const button = createElementWithText('button', label);
    button.type = 'button';
    button.onclick = run;
    return button;
  };
  const editNow = () => edit.latest();
  row.append(
    action('Add stop', () => addStops(edit, editNow)),
    action('Add turn', () => addTurn(edit, editNow)),
    action(directionsOf(edit.feature).length === 1 ? 'Add the other direction' : 'Copy from the other direction', () =>
      copyFromOther(edit)
    )
  );
  return row;
}

function renderRoute(container, edit) {
  const direction = directionsOf(edit.feature)[shownDirectionIndex(edit)];
  if (!direction) return;
  const {stops} = direction;
  const turnCount = stops.filter(isTurnPoint).length;
  const heading = createElementWithText('h3', `Stops in order · ${stops.length - turnCount}${turnCount ? ` + ${turnCount} turn` : ''}`);
  heading.className = 'section-title';
  const list = document.createElement('ol');
  list.className = 'route-stops';
  list.append(...stops.map((stop, index) => stopRow(stop, index, stops, edit)));
  container.append(directionTabs(edit), heading, list);
  if (!edit.context.isPhone()) container.append(directionActions(edit));
  edit.context.showPath(directionPath(stops, edit.context), edit.feature.properties.colour ?? defaultColour);
}

// A direction says where it goes; an intercity one has an identity, which a new one gets here.
function preparedRoute(feature, context) {
  const directions = directionsOf(feature).map(direction => {
    const lastStop = direction.stops.findLast(stop => !isTurnPoint(stop));
    const headsign = direction.headsign || (lastStop ? stopName(lastStop, context) : '');
    const needsIdentity = feature.properties.network === 'intercity' && !direction.entityId;
    return {...direction, headsign, ...(needsIdentity ? {entityId: `local:${crypto.randomUUID()}`} : {})};
  });
  return {...feature, properties: {...feature.properties, directions}};
}

function routeProblem({key, feature}, context) {
  const {number, name, network} = feature.properties;
  if (!number && !name) return 'A line needs a number or a name.';
  const twin = context
    .entriesOf(routesFile)
    .find(entry => entry.key !== key && entry.feature.properties.number === number && entry.feature.properties.network === network);
  const isOwnTwin = twin && number && directionsOf(feature).every(direction => !direction.entityId);
  return isOwnTwin ? `Line ${number} already exists in this network.` : null;
}

// The routes as they will stand, and the stops whose lines change with them.
function stopLineEdits({key, feature, before}, context) {
  const others = context.entriesOf(routesFile).filter(entry => entry.key !== key).map(entry => entry.feature);
  const routes = feature ? [...others, feature] : others;
  return lineEdits(context.entriesOf(stopsFile), routes, [feature, before].filter(Boolean));
}

export const routeBehaviors = {
  [routesFile]: {
    kind: ({properties}) => (properties.network === 'intercity' ? 'Intercity line' : 'Bus line'),
    title: ({properties}) => (properties.number ? `Line ${properties.number}` : (properties.name ?? 'New line')),
    sections: (_feature, {context}) =>
      context.isPhone() ? [] : [{title: 'Line', fields: ['number', 'name', 'network', 'colour']}],
    renderExtras: renderRoute,
    prepared: preparedRoute,
    problem: routeProblem,
    companionEdits: stopLineEdits,
    isViewOnly: context => context.isPhone(),
    deletion: ({key, feature}, context) => ({
      message: 'The stops stay.',
      edits: stopLineEdits({key, feature: null, before: feature}, context)
    })
  }
};
