// Shows one level of the road graph at a time: what is under or over it fades, and points join only roads of that level.
import {createElementWithText, elementById} from '../../shared/dom.js';

function levelButton(label, isPressed, run, description) {
  const button = createElementWithText('button', label);
  button.type = 'button';
  button.setAttribute('aria-pressed', String(isPressed));
  if (description) button.setAttribute('aria-label', description);
  button.onclick = run;
  return button;
}

// levels are the ones the layer has. shownLevel is one of them, or null for all.
export function showLevelPicker(levels, shownLevel, onChosen) {
  const picker = elementById('level-picker');
  // A layer on one level has nothing to choose.
  picker.hidden = levels.length < 2;
  if (picker.hidden) return;
  const previousFocus = document.activeElement?.closest('#level-picker') ? document.activeElement.textContent : null;
  const ordered = [...levels].sort((first, second) => second - first);
  picker.replaceChildren(
    levelButton('All', shownLevel === null, () => onChosen(null), 'All levels'),
    ...ordered.map(level => levelButton(String(level), shownLevel === level, () => onChosen(level), `Level ${level}`))
  );
  if (previousFocus) [...picker.children].find(({textContent}) => textContent === previousFocus)?.focus();
}

export function hideLevelPicker() {
  elementById('level-picker').hidden = true;
}
