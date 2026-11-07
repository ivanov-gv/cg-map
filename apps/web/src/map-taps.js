// MapLibre 5.12 treats a press released within 500 ms as a tap; a double tap or any drag in that window is a gesture.
const tapWindowMilliseconds = 500;

// Calls select(event) for a single tap, once its window has passed without a second contact or a camera move, and
// never prevents native gestures. Returns a function that removes every listener and pending selection.
export function installMapTaps(
  map,
  select,
  {
    delay = tapWindowMilliseconds,
    now = Date.now,
    schedule = (...args) => setTimeout(...args),
    cancel = timer => clearTimeout(timer)
  } = {}
) {
  let pendingTimer;
  let gestureEndsAt = 0;
  const cancelPending = () => {
    if (pendingTimer !== undefined) cancel(pendingTimer);
    pendingTimer = undefined;
  };
  const isBlocked = () => now() < gestureEndsAt || map.isMoving();
  const blockAfterDoubleClick = () => {
    cancelPending();
    gestureEndsAt = now() + delay;
  };
  const scheduleSelection = event => {
    cancelPending();
    const isRepeatedClick = event.originalEvent?.detail > 1;
    if (isRepeatedClick || isBlocked()) return;
    pendingTimer = schedule(() => {
      pendingTimer = undefined;
      if (!isBlocked()) select(event);
    }, delay);
  };
  const handlers = {
    click: scheduleSelection,
    touchstart: cancelPending,
    mousedown: cancelPending,
    touchcancel: cancelPending,
    dblclick: blockAfterDoubleClick,
    movestart: cancelPending,
    remove: cancelPending
  };
  for (const [type, handler] of Object.entries(handlers)) map.on(type, handler);
  return () => {
    cancelPending();
    for (const [type, handler] of Object.entries(handlers)) map.off(type, handler);
  };
}
