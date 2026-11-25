import {createElementWithText} from './dom.js';
import {fieldLabel, noValueLabel, valueLabel} from './field-catalog.js';

const noChoiceLabel = 'Choose…';

function optionElement(name, value, emptyLabel) {
  const option = createElementWithText('option', value === '' ? emptyLabel : valueLabel(name, value));
  option.value = String(value);
  return option;
}

// A whole number with so few possible values is picked, not typed.
const longestNumberList = 150;

function numberChoices({type, minimum, maximum, multipleOf = 1}) {
  const isBounded = type === 'integer' && minimum !== undefined && maximum !== undefined;
  const count = (maximum - minimum) / multipleOf + 1;
  if (!isBounded || count > longestNumberList) return null;
  return Array.from({length: count}, (_unused, index) => minimum + index * multipleOf);
}

// Whether a property is picked from the list its rule states.
export const hasClosedList = propertyRule =>
  Boolean(propertyRule.enum || propertyRule.isLevel || propertyRule.type === 'boolean' || numberChoices(propertyRule));

// A new feature starts with no choice, so a default can never be recorded by accident. A source value outside the
// rules stays selectable, so that opening its form does not change it. An optional value can be taken back.
function selectField(name, value, allowedValues, isRequired) {
  const select = document.createElement('select');
  select.name = name;
  const hasEmptyOption = value === undefined || !isRequired;
  const currentValues = value === undefined ? [] : [value];
  const optionValues = new Set([...(hasEmptyOption ? [''] : []), ...currentValues, ...allowedValues]);
  const emptyLabel = isRequired ? noChoiceLabel : noValueLabel(name);
  select.append(...[...optionValues].map(optionValue => optionElement(name, optionValue, emptyLabel)));
  select.value = String(value ?? '');
  return select;
}

function textField(name, value, propertyRule) {
  const input = document.createElement('input');
  input.name = name;
  input.value = value ?? '';
  if (propertyRule.maxLength) input.maxLength = propertyRule.maxLength;
  return input;
}

function numberField(name, value, propertyRule) {
  const input = textField(name, value, propertyRule);
  input.type = 'number';
  input.step = propertyRule.multipleOf ?? (propertyRule.type === 'integer' ? 1 : 'any');
  if (propertyRule.minimum !== undefined) input.min = propertyRule.minimum;
  if (propertyRule.maximum !== undefined) input.max = propertyRule.maximum;
  return input;
}

const booleanValues = ['true', 'false'];
const yesNoLabels = {true: 'Yes', false: 'No'};

function booleanField(name, value, isRequired) {
  const select = selectField(name, value === undefined ? undefined : String(value), booleanValues, isRequired);
  for (const option of select.options) option.textContent = yesNoLabels[option.value] ?? option.textContent;
  return select;
}

const isOnlyYes = propertyRule => propertyRule.enum?.length === 1 && propertyRule.enum[0] === 'yes';

// A flag the sources record only when it is set.
function flagField(name, value) {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = name;
  input.value = 'yes';
  input.checked = value === 'yes';
  return input;
}

const otherLabel = 'Other…';
// Cannot be a value: no source has it, and it is never recorded.
const otherChoice = '\u0000other';

// A list of the usual values, and free text for one that is not among them. The text field holds the value either way.
function usualValuesField(name, value, propertyRule, usualValues) {
  const input = textField(name, value, propertyRule);
  const select = selectField(name, value, usualValues, propertyRule.required);
  select.removeAttribute('name');
  select.dataset.listFor = name;
  select.setAttribute('aria-label', fieldLabel(name));
  const other = createElementWithText('option', otherLabel);
  other.value = otherChoice;
  select.append(other);
  input.hidden = true;
  input.setAttribute('aria-label', `Other ${fieldLabel(name).toLowerCase()}`);
  select.onchange = () => {
    const isOther = select.value === otherChoice;
    input.hidden = !isOther;
    input.value = isOther ? '' : select.value;
    if (isOther) input.focus();
    input.dispatchEvent(new Event('input', {bubbles: true}));
  };
  const wrapper = document.createElement('span');
  wrapper.append(select, input);
  return wrapper;
}

function fieldControl(name, value, propertyRule, levels, {controls, usualValues}) {
  if (controls[name]) return controls[name](value);
  if (propertyRule.isLevel) return selectField(name, value, [...levels], propertyRule.required);
  if (isOnlyYes(propertyRule)) return flagField(name, value);
  if (propertyRule.enum) return selectField(name, value, propertyRule.enum, propertyRule.required);
  if (usualValues[name]?.length > 0) return usualValuesField(name, value, propertyRule, usualValues[name]);
  if (propertyRule.type === 'boolean') return booleanField(name, value, propertyRule.required);
  const numbers = numberChoices(propertyRule);
  if (numbers) return selectField(name, value, numbers, propertyRule.required);
  if (['integer', 'number'].includes(propertyRule.type)) return numberField(name, value, propertyRule);
  return textField(name, value, propertyRule);
}

// Values a single field cannot state. Layers edit them with controls of their own.
const structuredTypes = new Set(['list', 'identifier', 'identifiers', 'directions']);

export function isFormField(propertyRule) {
  const isFixed = propertyRule.enum?.length === 1 && !isOnlyYes(propertyRule);
  return !structuredTypes.has(propertyRule.type) && !propertyRule.reference && !propertyRule.addOnly && !isFixed;
}

// One labelled control for a property the rules list.
export function propertyField(name, value, propertyRule, levels, customization = {controls: {}, usualValues: {}}) {
  const label = createElementWithText('label', fieldLabel(name) + (propertyRule.required ? ' (required)' : ''));
  label.append(fieldControl(name, value, propertyRule, levels, customization));
  return label;
}

function sectionElement({title, fields, isCollapsed}, properties, propertyRules, levels, customization) {
  const section = document.createElement(isCollapsed ? 'details' : 'fieldset');
  if (title) section.append(createElementWithText(isCollapsed ? 'summary' : 'legend', title));
  const grid = document.createElement('div');
  grid.className = 'field-grid';
  grid.append(
    ...fields.map(name => propertyField(name, properties[name], propertyRules[name], levels, customization))
  );
  section.append(grid);
  return section;
}

// The form of one object: its sections in order, each with the fields the rules allow. Everything else stays out of
// reach.
// controls replace single fields, {name: value => element}; usualValues are offered as a list, {name: [value]}.
export function renderPropertyForm(
  form,
  properties,
  propertyRules,
  levels,
  {sections = null, controls = {}, usualValues = {}} = {}
) {
  const allowedNames = Object.keys(propertyRules).filter(name => isFormField(propertyRules[name]));
  const wantedSections = sections ?? [{title: '', fields: allowedNames}];
  const shownSections = wantedSections
    .map(section => ({...section, fields: section.fields.filter(name => allowedNames.includes(name))}))
    .filter(({fields}) => fields.length > 0);
  form.replaceChildren(
    ...shownSections.map(section =>
      sectionElement(section, properties, propertyRules, levels, {controls, usualValues})
    )
  );
}

function parsedValue(value, propertyRule) {
  if (propertyRule.isLevel || ['integer', 'number'].includes(propertyRule.type)) return Number(value);
  if (propertyRule.type === 'boolean') return value === 'true';
  return value;
}

// Applies form values over the existing properties. A field left as it was is not touched at all, which keeps a source's
// blank name intact and makes an unchanged form record nothing. A property without a field keeps its value. A cleared
// optional field is removed, because the contract refuses empty text; a cleared required one fails validation.
export function propertiesFromForm(properties, formValues, propertyRules) {
  const nextProperties = {...properties};
  for (const [name, propertyRule] of Object.entries(propertyRules)) {
    if (!Object.hasOwn(formValues, name)) continue;
    const value = formValues[name];
    if (String(properties[name] ?? '') === value) continue;
    if (value !== '') nextProperties[name] = parsedValue(value, propertyRule);
    else if (propertyRule.allowsNull) nextProperties[name] = null;
    else if (!propertyRule.required) delete nextProperties[name];
    else nextProperties[name] = value;
  }
  return nextProperties;
}

// Every field of a form with its current text. An unchecked box reads as empty, so clearing it removes the flag.
export function formValues(form) {
  const values = Object.fromEntries(new FormData(form));
  for (const box of form.querySelectorAll('input[type="checkbox"][name]')) {
    if (!box.checked) values[box.name] = '';
  }
  return values;
}
