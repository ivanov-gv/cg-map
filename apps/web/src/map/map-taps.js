// Match MapLibre 5.12's 500 ms tap-drag window without preventing native gestures.
export function installMapTaps(
  map,
  select,
  {
    delay: delayMilliseconds = 500,
    now: readNowMilliseconds = Date.now,
    schedule = (...argumentsList) => setTimeout(...argumentsList),
    cancel = timerId => clearTimeout(timerId)
  } = {}
) {
  let timer;
  let blockedUntilMilliseconds = 0;
  const clear = () => {
    if (timer !== undefined) cancel(timer);
    timer = undefined;
  };
  const gesture = () => {
    clear();
    blockedUntilMilliseconds = readNowMilliseconds() + delayMilliseconds;
  };
  const click = event => {
    clear();
    if (event.originalEvent?.detail > 1 || readNowMilliseconds() < blockedUntilMilliseconds || map.isMoving())
      return;
    timer = schedule(() => {
      timer = undefined;
      if (readNowMilliseconds() >= blockedUntilMilliseconds && !map.isMoving()) select(event);
    }, delayMilliseconds);
  };
  const handlers = {
    click,
    touchstart: clear,
    mousedown: clear,
    touchcancel: clear,
    dblclick: gesture,
    movestart: clear,
    remove: clear
  };
  for (const [type, handler] of Object.entries(handlers)) map.on(type, handler);
  return () => {
    clear();
    for (const [type, handler] of Object.entries(handlers)) map.off(type, handler);
  };
}
