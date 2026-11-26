import {createElementWithText, elementById} from '../../shared/dom.js';
import {
  dayNames,
  formatOpeningHours,
  openingHoursPresets,
  openingHoursProblem,
  parseOpeningHours
} from './opening-hours.js';

const defaultInterval = {from: '08:00', to: '20:00'};
const defaultBreak = {from: '14:00', to: '16:00'};

function button(label, run) {
  const element = createElementWithText('button', label);
  element.type = 'button';
  element.onclick = run;
  return element;
}

function timeInput(value, label, onChange) {
  const input = document.createElement('input');
  input.value = value;
  input.placeholder = '08:00';
  input.setAttribute('aria-label', label);
  input.onchange = () => onChange(input.value.trim());
  return input;
}

// Edits one model in place and draws it again after every change.
class HoursEditor {
  #model;

  constructor(model) {
    this.#model = model;
  }

  get model() {
    return this.#model;
  }

  #change(change) {
    change();
    this.render();
  }

  usePreset(model) {
    this.#change(() => (this.#model = structuredClone(model)));
  }

  addGroup() {
    const usedDays = this.#model.groups.flatMap(({days}) => days);
    const freeDays = dayNames.slice(0, 7).filter(day => !usedDays.includes(day));
    this.#change(() => {
      this.#model.isAlwaysOpen = false;
      this.#model.groups.push({days: freeDays, intervals: [{...defaultInterval}]});
    });
  }

  #dayBoxes(group) {
    const row = document.createElement('div');
    row.className = 'day-boxes';
    for (const day of dayNames) {
      const label = createElementWithText('label', day === 'PH' ? 'Holidays' : day);
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = group.days.includes(day);
      // A day belongs to one group, so choosing it here takes it from the others.
      box.onchange = () =>
        this.#change(() => {
          for (const other of this.#model.groups) other.days = other.days.filter(otherDay => otherDay !== day);
          if (box.checked) group.days.push(day);
        });
      label.prepend(box);
      row.append(label);
    }
    return row;
  }

  #intervalRow(group, interval) {
    const row = document.createElement('div');
    row.className = 'interval-row';
    row.append(
      timeInput(interval.from, 'Opens at', value => this.#change(() => (interval.from = value))),
      createElementWithText('span', '–'),
      timeInput(interval.to, 'Closes at', value => this.#change(() => (interval.to = value))),
      button('Remove', () =>
        this.#change(() => (group.intervals = group.intervals.filter(other => other !== interval)))
      )
    );
    return row;
  }

  // A break splits the last stretch in two.
  #addBreak(group) {
    const last = group.intervals.pop();
    group.intervals.push({from: last.from, to: defaultBreak.from}, {from: defaultBreak.to, to: last.to});
  }

  #groupSection(group) {
    const section = document.createElement('fieldset');
    section.append(this.#dayBoxes(group), ...group.intervals.map(interval => this.#intervalRow(group, interval)));
    const isClosed = group.intervals.length === 0;
    if (isClosed) section.append(createElementWithText('p', 'Closed'));
    const addLabel = isClosed ? 'Open these days' : 'Add a break';
    const add = () => {
      if (isClosed) group.intervals.push({...defaultInterval});
      else this.#addBreak(group);
    };
    const remove = () => (this.#model.groups = this.#model.groups.filter(other => other !== group));
    const actions = document.createElement('div');
    actions.className = 'button-row';
    actions.append(button(addLabel, () => this.#change(add)), button('Remove days', () => this.#change(remove)));
    section.append(actions);
    return section;
  }

  render() {
    const {isAlwaysOpen, groups} = this.#model;
    const always = createElementWithText('p', 'Open all the time');
    elementById('hours-groups').replaceChildren(
      ...(isAlwaysOpen ? [always] : groups.map(group => this.#groupSection(group)))
    );
    const problem = openingHoursProblem(this.#model);
    elementById('hours-stored').textContent = problem ?? formatOpeningHours(this.#model);
    elementById('hours-done').disabled = Boolean(problem);
  }
}

// Opens on the stored text. Text the editor cannot show is replaced only by what someone chooses here.
export function editOpeningHours(text, onDone) {
  const parsed = text ? parseOpeningHours(text) : null;
  const editor = new HoursEditor(parsed ?? {isAlwaysOpen: false, groups: []});
  const dialog = elementById('hours-dialog');
  const unreadable = text && !parsed;
  elementById('hours-note').textContent = unreadable ? `Stored now, kept unless you choose new hours: ${text}` : '';
  elementById('hours-presets').replaceChildren(
    ...openingHoursPresets.map(({label, model}) => button(label, () => editor.usePreset(model)))
  );
  elementById('hours-add-group').onclick = () => editor.addGroup();
  elementById('hours-back').onclick = () => dialog.close();
  elementById('hours-clear').onclick = () => {
    dialog.close();
    onDone('');
  };
  elementById('hours-done').onclick = () => {
    dialog.close();
    onDone(formatOpeningHours(editor.model));
  };
  editor.render();
  dialog.showModal();
}
