// The visual viewport shrinks and may move when a phone keyboard opens. Layout viewport units alone leave the
// inspector's actions behind that keyboard. Keep the panels inside the visible area without resizing the map.
export function installInspectorViewport() {
  const viewport = window.visualViewport;
  if (!viewport) return;
  // Below this height, the toolbar clearance would leave less than a full input between heading and actions.
  const shortViewportHeightPixels = 360;
  const content = document.querySelector('.inspector-content');
  const revealActiveField = () => {
    const activeField = document.activeElement;
    if (content.contains(activeField)) activeField.scrollIntoView({block: 'nearest'});
  };
  const updateViewport = () => {
    const root = document.documentElement;
    root.classList.toggle('has-short-viewport', viewport.height < shortViewportHeightPixels);
    const style = root.style;
    const bottomInset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
    style.setProperty('--viewport-height', `${viewport.height}px`);
    style.setProperty('--viewport-top', `${viewport.offsetTop}px`);
    style.setProperty('--viewport-bottom', `${bottomInset}px`);
    requestAnimationFrame(revealActiveField);
  };
  viewport.addEventListener('resize', updateViewport);
  viewport.addEventListener('scroll', updateViewport);
  window.addEventListener('resize', updateViewport);
  content.addEventListener('focusin', () => requestAnimationFrame(revealActiveField));
  updateViewport();
}
