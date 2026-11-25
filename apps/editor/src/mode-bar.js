import {createElementWithText, elementById} from './dom.js';

// The bar grows with its hint and buttons, and what stands beside it makes room.
function shareHeight() {
  const {offsetHeight} = elementById('mode-bar');
  document.documentElement.style.setProperty('--mode-bar-height', `${offsetHeight}px`);
}

// While someone moves, edits corners or draws, the inspector shrinks to this one control.
// state: {title, hint, notice, buttons: [{id, label, run(), isPrimary, isDisabled, isPressed}]}
export function showModeBar({title, hint, notice = null, buttons}) {
  elementById('mode-title').textContent = title;
  elementById('mode-hint').textContent = hint;
  elementById('mode-notice').textContent = notice ?? '';
  elementById('mode-notice').hidden = !notice;
  const previousFocusId = document.activeElement?.id;
  const buttonElements = buttons.map(({id, label, run, isPrimary, isDisabled, isPressed}) => {
    const button = createElementWithText('button', label);
    button.id = id;
    button.type = 'button';
    button.disabled = Boolean(isDisabled);
    button.classList.toggle('primary', Boolean(isPrimary));
    if (isPressed !== undefined) button.setAttribute('aria-pressed', String(isPressed));
    button.onclick = run;
    return button;
  });
  elementById('mode-buttons').replaceChildren(...buttonElements);
  elementById('mode-bar').hidden = false;
  shareHeight();
  // Rendering again on every point must not drop a keyboard user out of the bar.
  if (previousFocusId) buttonElements.find(({id}) => id === previousFocusId)?.focus();
}

export function hideModeBar() {
  elementById('mode-bar').hidden = true;
}

export function setCrossVisible(isVisible) {
  elementById('map-cross').hidden = !isVisible;
}
