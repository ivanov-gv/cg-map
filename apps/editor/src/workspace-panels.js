import {elementById} from './dom.js';
import {isExportDialogVisible} from './review-panel.js';

// The panels occupy at most 360 + 380 px; 740 / 0.45 leaves more than half of a 1650 px window for the map.
const sharedPanelSpace = matchMedia('(max-width: 1650px)');
let panelOpener = null;

const inspector = () => document.querySelector('.inspector');
const utilityPanels = () => [...document.querySelectorAll('.utility-panel')];
const openPanel = () => utilityPanels().find(panel => !panel.hidden);

export const isInspectorOpen = () => !inspector().hidden;
export const inspectorHasFocus = () => inspector().contains(document.activeElement);

// Collapse changes presentation only. Explicit Cancel owns discarding the edit.
export function collapseInspector(shouldFocus = true) {
  inspector().hidden = true;
  const opener = elementById('open-inspector');
  opener.hidden = false;
  opener.setAttribute('aria-expanded', 'false');
  if (shouldFocus) opener.focus();
}

// Panels share space without changing the map or the pending edit. One panel is open at a time.
export function showPanel(panelId, opener = null) {
  if (panelId) panelOpener = opener;
  for (const panel of utilityPanels()) panel.hidden = panel.id !== panelId;
  for (const button of document.querySelectorAll('[data-panel]')) {
    button.setAttribute('aria-expanded', String(button.dataset.panel === panelId));
  }
  elementById('current-layer').setAttribute('aria-expanded', String(panelId === 'layers-panel'));
  if (panelId && sharedPanelSpace.matches && isInspectorOpen()) collapseInspector(false);
}

export function setPanelOpener(opener) {
  panelOpener = opener;
}

export function togglePanel(panelId, opener) {
  showPanel(elementById(panelId).hidden ? panelId : null, opener);
}

export function showInspector() {
  if (sharedPanelSpace.matches) showPanel(null);
  inspector().hidden = false;
  elementById('open-inspector').hidden = true;
  elementById('open-inspector').setAttribute('aria-expanded', 'true');
}

// Nothing is picked, or a mode has shrunk the inspector to its own control.
export function hideInspector() {
  inspector().hidden = true;
  elementById('open-inspector').hidden = true;
  elementById('open-inspector').setAttribute('aria-expanded', 'false');
}

// The object list opens from Tools, so it has no toolbar button of its own.
const toolbarButtonFor = panel =>
  document.querySelector(`[data-panel="${panel.id}"]`) ?? document.querySelector('[data-panel="tools-panel"]');

function closeOpenPanel() {
  const panel = openPanel();
  const opener = panelOpener;
  showPanel(null);
  const isOpenerVisible = opener?.checkVisibility?.() ?? Boolean(opener?.getClientRects().length);
  if (isOpenerVisible) opener.focus();
  else toolbarButtonFor(panel).focus();
}

// Escape dismisses the foremost surface without discarding work. Returns whether there was one.
function dismissForemost() {
  if (isInspectorOpen() && inspectorHasFocus()) {
    collapseInspector();
    return true;
  }
  if (openPanel()) {
    closeOpenPanel();
    return true;
  }
  if (!isInspectorOpen()) return false;
  collapseInspector();
  return true;
}

// hooks: {cancelActiveGesture(), isSwitchDialogOpen(), closeSwitchDialog(), leaveMode()}. Each returns whether it did
// anything, except closeSwitchDialog.
function installEscape(hooks) {
  document.addEventListener('keydown', event => {
    const isImeKey = event.isComposing || event.keyCode === 229;
    if (event.key !== 'Escape' || event.defaultPrevented || isImeKey) return;
    // Dialogs handle Escape themselves; don't close panels while one is open.
    const isOwnDialogOpen = document.querySelector('dialog[open]:not(#layer-switch-dialog)') !== null;
    if (isExportDialogVisible() || isOwnDialogOpen) return;
    if (hooks.cancelActiveGesture()) {
      event.preventDefault();
      return;
    }
    if (hooks.isSwitchDialogOpen()) {
      event.preventDefault();
      hooks.closeSwitchDialog();
      return;
    }
    if (hooks.leaveMode() || dismissForemost()) event.preventDefault();
  });
}

// Collapse one panel when a resize would leave too little map visible.
function installPanelResize() {
  sharedPanelSpace.addEventListener('change', event => {
    if (event.matches && openPanel() && isInspectorOpen()) collapseInspector(inspectorHasFocus());
  });
}

function installPanelButtons() {
  for (const button of document.querySelectorAll('[data-panel]')) {
    button.disabled = false;
    button.onclick = event => togglePanel(button.dataset.panel, event.currentTarget);
  }
  for (const button of document.querySelectorAll('[data-close-panel]')) {
    button.onclick = closeOpenPanel;
  }
  elementById('current-layer').disabled = false;
  elementById('current-layer').onclick = event => togglePanel('layers-panel', event.currentTarget);
  elementById('offline-notice').onclick = event => showPanel('layers-panel', event.currentTarget);
  elementById('draft-notice').onclick = event => showPanel('changes-panel', event.currentTarget);
  elementById('close-inspector').onclick = () => collapseInspector();
  elementById('open-inspector').onclick = () => {
    showInspector();
    elementById('close-inspector').focus();
  };
}

// Workspace interactions work before asynchronous startup finishes.
export function installWorkspace(hooks) {
  installPanelResize();
  installPanelButtons();
  installEscape(hooks);
}
