// The visual viewport shrinks and may move when a phone keyboard opens. Layout viewport units alone leave the
// inspector's actions behind that keyboard. Keep the panels inside the visible area without resizing the map.
export function installInspectorViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  // Below this height, the toolbar clearance would leave less than a full input between heading and actions.
  const shortViewportHeightPixels = 360;
  // Ignore small viewport rounding and browser chrome changes when deciding whether a keyboard is present.
  const keyboardInsetPixels = 100;
  const content = document.querySelector('.inspector-content');
  const revealActiveField = () => {
    const activeField = document.activeElement;
    if (content.contains(activeField)) activeField.scrollIntoView({block: 'nearest'});
  };
  let framePending = false;
  let previousViewport = '';
  const updateViewport = () => {
    framePending = false;
    const root = document.documentElement;
    const bottomInset = Math.max(0, root.clientHeight - viewport.height - viewport.offsetTop);
    const scale = viewport.scale || 1;
    const unoccludedHeight = root.clientHeight / scale;
    const keyboardOcclusion = Math.max(0, unoccludedHeight - viewport.height);
    const currentViewport = `${viewport.height},${viewport.offsetTop},${bottomInset},${scale}`;
    if (currentViewport !== previousViewport) {
      previousViewport = currentViewport;
      root.classList.toggle('has-short-viewport', viewport.height < shortViewportHeightPixels);
      root.classList.toggle('has-keyboard-inset', keyboardOcclusion >= keyboardInsetPixels);
      root.style.setProperty('--viewport-height', `${viewport.height}px`);
      root.style.setProperty('--viewport-top', `${viewport.offsetTop}px`);
      root.style.setProperty('--viewport-bottom', `${bottomInset}px`);
      revealActiveField();
    }
  };
  const scheduleUpdate = () => {
    if (framePending) return;
    framePending = true;
    requestAnimationFrame(updateViewport);
  };
  viewport.addEventListener('resize', scheduleUpdate);
  viewport.addEventListener('scroll', scheduleUpdate);
  window.addEventListener('resize', scheduleUpdate);
  content.addEventListener('focusin', () => requestAnimationFrame(revealActiveField));
  scheduleUpdate();
}
