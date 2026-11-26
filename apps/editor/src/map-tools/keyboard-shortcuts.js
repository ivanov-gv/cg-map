import {elementById} from '../shared/dom.js';

// Show platform-specific shortcut labels (Ctrl vs Cmd) in the Tools panel.
export function updateShortcutHints() {
  const platform = navigator.userAgentData?.platform ?? navigator.platform;
  const modifierLabel = platform.includes('Mac') ? '⌘' : 'Ctrl';
  const hint = elementById('undo-shortcut-hint');
  hint.querySelector('[data-shortcut-undo]').textContent = `${modifierLabel}+Z`;
  hint.querySelector('[data-shortcut-redo]').textContent = `${modifierLabel}+Shift+Z`;
}

// The button a key combination stands for, or null.
function shortcutButtonId(event) {
  const isImeKey = event.isComposing || event.keyCode === 229;
  const hasCommandModifier = event.ctrlKey || event.metaKey;
  if (isImeKey || event.altKey || !hasCommandModifier) return null;
  const key = event.key.toLowerCase();
  if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
  return key === 'y' ? 'redo' : null;
}

// Undo and redo work in the workspace but not inside text controls.
export function installKeyboardShortcuts() {
  document.addEventListener('keydown', event => {
    const buttonId = shortcutButtonId(event);
    if (!buttonId || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const button = elementById(buttonId);
    if (button.disabled) return;
    event.preventDefault();
    button.click();
  });
}
