import {elementById} from '../shared/dom.js';

const shownMilliseconds = 8000;
let hideTimer = null;

// A short message with one way back. The action stays available in Tools after the toast is gone.
export function showToast(message, {actionLabel = 'Undo', action = null} = {}) {
  elementById('toast-message').textContent = message;
  const button = elementById('toast-action');
  button.hidden = !action;
  button.textContent = actionLabel;
  button.onclick = () => {
    hideToast();
    action();
  };
  elementById('toast').hidden = false;
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideToast, shownMilliseconds);
}

export function hideToast() {
  clearTimeout(hideTimer);
  elementById('toast').hidden = true;
}
