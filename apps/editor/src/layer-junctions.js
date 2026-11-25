// A junction of the road graph, as something to open and edit: which roads meet, on which level, what stands there and
// which turns are allowed. It is no object of a source file. What changes is the roads, the lights and the turn rules.
import {createElementWithText} from './dom.js';
import {valueLabel} from './field-catalog.js';
import {disconnectEdits, joinEdits, junctionEdits, levelChoiceKey, splitEdits} from './road-edits.js';
import {jointNear, pointKey} from './road-graph.js';
import {compassOf, nodeEntryAt, ruleOfTurn, turnKey, turnsAt} from './road-junctions.js';

const roadsFile = 'roads.geojson';
const nodesFile = 'road-nodes.geojson';
const restrictionsFile = 'turn-restrictions.json';
const highestLevel = 5;

// The name under which the inspector knows a junction.
export const junctionFile = 'road-junction';

// What the inspector may do with a junction: move it. Its facts are not properties of one object.
export const junctionRule = {operations: ['modify'], geometries: ['Point'], properties: {}};

// An entry for the junction at this point. Its key is local, because no source file has it.
export const junctionEntry = coordinate => ({
  filename: junctionFile,
  key: `local:${pointKey(coordinate)}`,
  feature: {type: 'Feature', properties: {}, geometry: {type: 'Point', coordinates: coordinate}}
});

const coordinateOfKey = key => key.slice('local:'.length).split(' ').map(Number);

const jointOfEntry = ({key}, context) => jointNear(coordinateOfKey(key), context.entriesOf(roadsFile));

const roadName = ({properties}) => properties.name?.trim() || valueLabel('kind', properties.kind ?? 'road');
const uniqueNames = entries => [...new Set(entries.map(({feature}) => roadName(feature)))];
const levelText = level => (level === 0 ? 'on the ground' : `on level ${level}`);
const roadsOf = joint => joint.roads ?? joint.members.map(({entry}) => entry);

// What a joint is, in a few words. ownKey is the road someone reads about, which is not named again.
export function jointStatusText(joint, ownKey = null) {
  if (!joint) return 'Not drawn yet';
  const others = roadsOf(joint).filter(({key}) => key !== ownKey);
  const names = uniqueNames(others).join(', ');
  if (joint.status === 'deadEnd') return 'Dead end';
  if (joint.status === 'joined') return `Joins ${names || 'itself'}`;
  if (joint.status === 'apart') return `Touches ${names}, on another level`;
  return joint.status === 'near' ? `Ends beside ${roadName(joint.missed.entry.feature)}` : `Crosses ${names}`;
}

function summaryOf(joint) {
  const count = roadsOf(joint).length;
  if (joint.status === 'deadEnd') return 'One road ends here and joins no other.';
  if (joint.status === 'joined') return `${count} roads join here ${levelText(joint.groups[0].level)}.`;
  if (joint.status === 'near') return `This road ends beside ${roadName(joint.missed.entry.feature)} and does not join it.`;
  if (joint.status === 'crossing') return 'These roads cross on one level and do not join.';
  return 'These roads touch on different levels, so they do not all join.';
}

function paragraph(text, className = 'hint') {
  const element = createElementWithText('p', text);
  element.className = className;
  return element;
}

function button(label, run) {
  const element = createElementWithText('button', label);
  element.type = 'button';
  element.onclick = run;
  return element;
}

function heading(text) {
  const element = createElementWithText('h3', text);
  element.className = 'section-title';
  return element;
}

// Changes that are whole on their own are recorded at once, with Undo in the toast.
function recordAtOnce(edit, {edits, problem}, message) {
  if (edit.hasUnappliedEdit()) edit.showProblem('Apply or Cancel what you changed here first.');
  else if (problem) edit.showProblem(problem);
  else edit.replaceWith(edits, message);
}

function levelControl(member, edit) {
  const {extras, context} = edit;
  const key = levelChoiceKey(member);
  const select = document.createElement('select');
  for (let level = highestLevel; level >= -highestLevel; level -= 1) {
    const option = createElementWithText('option', level === 0 ? '0 · ground' : String(level));
    option.value = String(level);
    select.append(option);
  }
  select.value = String(extras[key] ?? member.level);
  select.disabled = context.isPhone();
  select.setAttribute('aria-label', `Level of ${roadName(member.entry.feature)} here`);
  select.onchange = () => edit.setExtras({[key]: Number(select.value)});
  return select;
}

const directionOf = ({entry, index}, coordinate) => {
  const {coordinates} = entry.feature.geometry;
  const next = coordinates[index + 1] ?? coordinates[index - 1];
  return compassOf(coordinate, next);
};

// One road of the joint: where it goes, its level here, and the ways out of the joint and to the road.
function roadRow(member, joint, edit) {
  const {entry, end} = member;
  const row = document.createElement('div');
  row.className = 'junction-road';
  const place = end ? `ends here, from the ${directionOf(member, joint.coordinate)}` : 'passes here';
  const name = createElementWithText('p', `${roadName(entry.feature)} · ${place}`);
  const controls = document.createElement('div');
  controls.className = 'button-row';
  const level = end ? levelControl(member, edit) : paragraph(`Level ${member.level}, as the road`);
  controls.append(level, button('Open', () => openRoad(entry, edit)));
  const canDisconnect = joint.members.length > 1 && !edit.context.isPhone();
  if (canDisconnect) {
    controls.append(
      button('Disconnect', () => recordAtOnce(edit, disconnectEdits(joint, member, edit.context), `Disconnected · ${roadName(entry.feature)}`))
    );
  }
  row.append(name, controls);
  return row;
}

function openRoad(entry, edit) {
  if (edit.hasUnappliedEdit()) edit.showProblem('Apply or Cancel what you changed here first.');
  else edit.context.select(entry);
}

function furnitureControl(joint, edit) {
  const {context, extras} = edit;
  const known = nodeEntryAt(context.entriesOf(nodesFile), joint.coordinate);
  const kinds = context.rules.layers[nodesFile].properties.kind.enum;
  const label = createElementWithText('label', 'What stands here');
  const select = document.createElement('select');
  const none = createElementWithText('option', 'Nothing recorded');
  none.value = '';
  select.append(none);
  for (const kind of kinds) {
    const option = createElementWithText('option', valueLabel('kind', kind));
    option.value = kind;
    select.append(option);
  }
  select.value = extras.furniture ?? known?.feature.properties.kind ?? '';
  select.disabled = context.isPhone();
  select.onchange = () => edit.setExtras({furniture: select.value});
  label.append(select);
  return label;
}

const turnLabels = {left: 'Left', right: 'Right', straight: 'Straight on', uTurn: 'U-turn'};
const armName = ({member, next}, coordinate) => `${roadName(member.entry.feature)}, ${compassOf(coordinate, next)}`;

function turnRow(from, turn, members, joint, edit) {
  const {to, kind, canRecord} = turn;
  const rule = ruleOfTurn(edit.context.entriesOf(restrictionsFile), from, to, members);
  const key = turnKey(from, to);
  const label = document.createElement('label');
  label.className = 'choice-row';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = edit.extras[key] ?? !rule.isForbidden;
  input.disabled = !canRecord || Boolean(rule.onlyRule) || edit.context.isPhone();
  input.onchange = () => edit.setExtras({[key]: input.checked});
  const target = kind === 'uTurn' ? '' : ` onto ${armName(to, joint.coordinate)}`;
  const onlyText = rule.onlyRule ? ` · rule: ${rule.onlyRule.feature.properties.restriction.replaceAll('_', ' ')}` : '';
  label.append(input, ` ${turnLabels[kind]}${target}${onlyText}`);
  return label;
}

// The allowed turns, by the road someone comes from.
function turnSection(joint, edit) {
  const groups = turnsAt(joint);
  if (groups.length === 0) return [];
  const isPassed = groups.some(({turns}) => turns.some(({canRecord}) => !canRecord));
  const rows = groups.map(({from, members, turns}) => {
    const details = document.createElement('details');
    details.append(createElementWithText('summary', `From ${armName(from, joint.coordinate)}`));
    details.append(...turns.map(turn => turnRow(from, turn, members, joint, edit)));
    return details;
  });
  const hint = isPassed && !edit.context.isPhone() ? [splitHint(joint, edit)] : [];
  return [heading('Allowed turns'), ...hint, ...rows];
}

function splitHint(joint, edit) {
  const wrapper = document.createElement('div');
  wrapper.append(
    paragraph('A turn rule names whole roads. Split the roads that pass here to set their turns.'),
    button('Split roads here', () => recordAtOnce(edit, splitEdits(joint, edit.context), 'Roads split here'))
  );
  return wrapper;
}

const joinLabels = {apart: 'Join them on one level', near: 'Join it', crossing: 'Join them here'};

function joinSection(joint, edit) {
  if (!joinLabels[joint.status] || edit.context.isPhone()) return [];
  return [button(joinLabels[joint.status], () => recordAtOnce(edit, joinEdits(joint), 'Roads joined'))];
}

function renderJunction(container, edit) {
  const joint = jointOfEntry(edit, edit.context);
  if (!joint) {
    container.append(paragraph('No road has a point here any more.'));
    return;
  }
  container.append(paragraph(summaryOf(joint), joint.status === 'joined' || joint.status === 'deadEnd' ? 'hint' : 'notice'));
  container.append(...joinSection(joint, edit));
  if (joint.status === 'crossing') return;
  const rows = joint.members.map(member => roadRow(member, joint, edit));
  container.append(heading('Roads'), ...rows, furnitureControl(joint, edit), ...turnSection(joint, edit));
}

function junctionTitle(feature, context) {
  const joint = feature.geometry && jointNear(feature.geometry.coordinates, context.entriesOf(roadsFile));
  return joint ? uniqueNames(roadsOf(joint)).slice(0, 3).join(' × ') : 'Junction';
}

function junctionCompanions({key, feature, extras}, context) {
  const joint = jointOfEntry({key}, context);
  return joint?.members ? junctionEdits(joint, feature.geometry.coordinates, extras, context) : [];
}

export const junctionBehaviors = {
  [junctionFile]: {
    // Its own feature only says where it is; what is recorded are the objects that make it.
    isDerived: true,
    kind: () => 'Junction',
    title: junctionTitle,
    sections: () => [],
    renderExtras: renderJunction,
    companionEdits: junctionCompanions,
    // A crossing is no point of any road yet, so there is nothing to move.
    isReshapable: context => !context.isPhone(),
    isViewOnly: context => context.isPhone()
  }
};
