import {createElementWithText} from './dom.js';
import {fieldLabel, valueLabel} from './field-catalog.js';

const noChoiceLabel = 'Choose…';
const notRecordedLabel = '— not recorded';

function optionElement(name, value, emptyLabel) {
  const option = createElementWithText('option', value === '' ? emptyLabel : valueLabel(name, value));
  option.value = String(value);
  return option;
}

// A new feature starts with no choice, so a default can never be recorded by accident. A source value outside the
// rules stays selectable, so that opening its form does not change it. An optional value can be taken back.
function selectField(name, value, allowedValues, isRequired) {
  const select = document.createElement('select');
  select.name = name;
  const hasEmptyOption = value === undefined || !isRequired;
  const currentValues = value === undefined ? [] : [value];
  const optionValues = new Set([...(hasEmptyOption ? [''] : []), ...currentValues, ...allowedValues]);
  const emptyLabel = isRequired ? noChoiceLabel : notRecordedLabel;
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

function fieldControl(name, value, propertyRule, levels) {
  if (propertyRule.isLevel) return selectField(name, value, [...levels], propertyRule.required);
  if (isOnlyYes(propertyRule)) return flagField(name, value);
  if (propertyRule.enum) return selectField(name, value, propertyRule.enum, propertyRule.required);
  if (propertyRule.type === 'boolean') return booleanField(name, value, propertyRule.required);
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
export function propertyField(name, value, propertyRule, levels) {
  const label = createElementWithText('label', fieldLabel(name) + (propertyRule.required ? ' (required)' : ''));
  label.append(fieldControl(name, value, propertyRule, levels));
  return label;
}

function sectionElement({title, fields, isCollapsed}, properties, propertyRules, levels) {
  const section = document.createElement(isCollapsed ? 'details' : 'fieldset');
  if (title) section.append(createElementWithText(isCollapsed ? 'summary' : 'legend', title));
  const grid = document.createElement('div');
  grid.className = 'field-grid';
  grid.append(...fields.map(name => propertyField(name, properties[name], propertyRules[name], levels)));
  section.append(grid);
  return section;
}

// The form of one object: its sections in order, each with the fields the rules allow. Everything else stays out of
// reach.
export function renderPropertyForm(form, properties, propertyRules, levels, sections = null) {
  const allowedNames = Object.keys(propertyRules).filter(name => isFormField(propertyRules[name]));
  const wantedSections = sections ?? [{title: '', fields: allowedNames}];
  const shownSections = wantedSections
    .map(section => ({...section, fields: section.fields.filter(name => allowedNames.includes(name))}))
    .filter(({fields}) => fields.length > 0);
  form.replaceChildren(
    ...shownSections.map(section => sectionElement(section, properties, propertyRules, levels))
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
