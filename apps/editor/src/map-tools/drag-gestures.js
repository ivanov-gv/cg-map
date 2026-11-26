// Turns mouse and single-finger touch input into start, move, end and cancel of one drag. Listeners stay installed
// for the life of the map, so a gesture cannot leave one attached. onStart returns whether this press is a drag;
// preventDefault then keeps it from panning the map. A second finger or losing the window interrupts the gesture.
export function installDragGestures(map, {onStart, onMove, onEnd, onCancel}) {
  let isDragging = false;

  const start = event => {
    if (!onStart(event)) return;
    event.preventDefault();
    isDragging = true;
  };
  const move = event => {
    if (isDragging) onMove(event.lngLat.toArray());
  };
  const end = () => {
    if (!isDragging) return;
    isDragging = false;
    onEnd();
  };
  const cancel = () => {
    if (!isDragging) return;
    isDragging = false;
    onCancel();
  };

  map.on('mousedown', event => {
    const isLeftButton = event.originalEvent.button === 0;
    if (isLeftButton) start(event);
  });
  map.on('touchstart', event => {
    const isSingleFinger = event.originalEvent.touches.length === 1;
    if (isSingleFinger) start(event);
    else cancel();
  });
  map.on('mousemove', move);
  map.on('touchmove', move);
  map.on('touchend', end);
  map.on('touchcancel', cancel);
  // The release can happen outside the canvas, where the map reports nothing.
  window.addEventListener('mouseup', end);
  window.addEventListener('blur', cancel);
}
