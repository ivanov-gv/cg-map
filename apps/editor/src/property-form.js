import {createElementWithText} from './dom.js';

const fieldLabel = (name, propertyRule) => (propertyRule.required ? `${name} (required)` : name);
const noChoiceLabel = 'Choose…';

function optionElement(value) {
  const option = createElementWithText('option', value === '' ? noChoiceLabel : String(value));
  option.value = String(value);
  return option;
}

// A new feature starts with no choice, so a default can never be recorded by accident. A source value outside the
// rules stays selectable, so that opening its form does not change it.
function selectField(name, value, allowedValues) {
  const select = document.createElement('select');
  select.name = name;
  const optionValues = new Set([...(value === undefined ? [''] : [value]), ...allowedValues]);
  select.append(...[...optionValues].map(optionElement));
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

function fieldControl(name, value, propertyRule, levels) {
  if (propertyRule.isLevel) return selectField(name, value, [...levels]);
  if (propertyRule.enum) return selectField(name, value, propertyRule.enum);
  return textField(name, value, propertyRule);
}

// One labelled control per property the contract lists for this file. Everything else stays out of reach.
export function renderPropertyForm(form, properties, propertyRules, levels) {
  form.replaceChildren();
  for (const [name, propertyRule] of Object.entries(propertyRules)) {
    const label = createElementWithText('label', fieldLabel(name, propertyRule));
    label.append(fieldControl(name, properties[name], propertyRule, levels));
    form.append(label);
  }
}

// Applies form values over the existing properties. A field left as it was is not touched at all, which keeps a source's
// blank name intact and makes an unchanged form record nothing. A cleared optional field is removed, because the
// contract refuses empty text; a cleared required one fails validation.
export function propertiesFromForm(properties, formValues, propertyRules) {
  const nextProperties = {...properties};
  for (const [name, propertyRule] of Object.entries(propertyRules)) {
    const value = formValues[name];
    if (String(properties[name] ?? '') === value) continue;
    if (propertyRule.isLevel) nextProperties[name] = Number(value);
    else if (value === '' && !propertyRule.required) delete nextProperties[name];
    else nextProperties[name] = value;
  }
  return nextProperties;
}
