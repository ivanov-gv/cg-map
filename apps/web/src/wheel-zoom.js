// Deterministic wheel-zoom replacement for MapLibre's ScrollZoomHandler.
// MapLibre classifies a scroll gesture as "wheel" or "trackpad" from timing:
// on the second event it picks "trackpad" when millisecondsSincePreviousEvent * delta < 200.
// When the main thread is busy, two mouse notches can arrive 0-1 ms apart,
// so the mouse is mislabelled as a trackpad and zooms ~4x faster.
// This module classifies device from event values only, never from timing.

// MapLibre converts line and page modes to pixels before processing.
// Line mode (deltaMode 1) is treated as 40 pixels per line.
const PIXELS_PER_LINE = 40;
// Page mode (deltaMode 2) is treated as 800 pixels per page.
const PIXELS_PER_PAGE = 800;

// Shift key divides the zoom amount by 4 for precise control (MapLibre behavior).
const SHIFT_PRECISION_DIVISOR = 4;

// Firefox and Chrome on macOS report this exact value per mouse wheel notch.
// Trackpads produce arbitrary floats, so a zero remainder identifies a mouse.
const MOUSE_PIXEL_QUANTUM = 4.000244140625;

// Large pixel values (|pixels| >= 50) are almost always from a mouse wheel,
// not a trackpad gesture. Trackpad deltas are typically small.
const LARGE_SCROLL_THRESHOLD = 50;

// MapLibre's own rates, so speed matches its defaults. A notch is one large delta, while a trackpad sends many small
// ones, so the trackpad needs a higher rate per pixel to zoom as far for the same finger travel.
const MOUSE_ZOOM_RATE = 1 / 450;
const TRACKPAD_ZOOM_RATE = 1 / 100;

// MapLibre's gesture boundary: a pause this long means the next event may come from a different device.
const GESTURE_GAP_MILLISECONDS = 400;

// Notches are coarse steps, so they are animated with an ease-out curve.
const MOUSE_EASE_DURATION_MILLISECONDS = 200;

// Trackpad events use a short animated ease so chained eases share one movestart/moveend.
// A duration-0 ease ends synchronously and fires moveend on every event.
const TRACKPAD_EASE_DURATION_MILLISECONDS = 100;

// Named easeId so MapLibre chains consecutive eases: a new easeTo with the same easeId interrupts
// the running one without firing moveend or a new movestart (see _afterEase in maplibre-gl.js).
const WHEEL_ZOOM_EASE_ID = 'wheelZoom';

/**
 * Convert a wheel event's delta to pixels, ignoring deltaX like MapLibre does.
 * Returns the pixel value before any shift-key divisor so the caller can choose
 * the device from the unshifted amount and then apply the divisor to the zoom only.
 */
export function wheelPixels({deltaY, deltaMode}) {
  let pixels = deltaY;
  if (deltaMode === 1) {
    pixels = deltaY * PIXELS_PER_LINE;
  } else if (deltaMode === 2) {
    pixels = deltaY * PIXELS_PER_PAGE;
  }
  return pixels;
}

/**
 * Classify the input device from wheel event values only, never from timing.
 * Returns 'mouse' or 'trackpad'.
 *
 * Rules (in priority order):
 * - Non-pixel deltaMode (line or page) is always a mouse wheel.
 * - ctrlKey indicates a trackpad pinch gesture (browsers report this on every OS).
 * - Pixel values that are exact multiples of the mouse quantum come from a mouse
 *   wheel encoder.
 * - Large absolute pixel values (>= 50) are mouse, not trackpad.
 * - Everything else is treated as a trackpad.
 */
export function wheelDevice({pixels, deltaMode, ctrlKey}) {
  // Line or page mode only comes from a mouse wheel.
  if (deltaMode !== 0) {
    return 'mouse';
  }
  // Browsers report a trackpad pinch as ctrl + wheel on every OS.
  if (ctrlKey) {
    return 'trackpad';
  }
  // Firefox and Chrome on macOS report exact multiples of the quantum per notch.
  if (pixels !== 0 && pixels % MOUSE_PIXEL_QUANTUM === 0) {
    return 'mouse';
  }
  // Large scrolls are mouse; trackpads produce small deltas.
  if (Math.abs(pixels) >= LARGE_SCROLL_THRESHOLD) {
    return 'mouse';
  }
  return 'trackpad';
}

// Trackpad events already arrive continuously, so their short ease needs no curve of its own.
function linear(progress) {
  return progress;
}

// Starts fast and settles, so a notch responds at once without a hard stop.
function easeOut(progress) {
  return progress * (2 - progress);
}

/**
 * Tracks a wheel zoom gesture and returns the zoom-level change per event.
 * A gesture begins when more than 400 ms pass since the previous event.
 * The device is decided from the gesture's first event and kept for the rest.
 * Time is only used to find gesture boundaries, never to choose device or amount.
 */
export class WheelZoomGesture {
  #device = null;
  #previousEventMilliseconds = null;
  #lastCallStartedGesture = false;

  get device() {
    return this.#device;
  }

  get startsGesture() {
    return this.#lastCallStartedGesture;
  }

  // The sigmoid keeps small deltas responsive and caps one large delta below one zoom level.
  // When shiftKey is true, the zoom amount is divided by SHIFT_PRECISION_DIVISOR after device detection.
  // Returns 0 when pixels is 0 (must not start or label a gesture).
  zoomChange({pixels, deltaMode, ctrlKey, timeMilliseconds, shiftKey}) {
    // A zero-delta event must not start or label a gesture, and must not update timing.
    if (pixels === 0) {
      this.#lastCallStartedGesture = false;
      return 0;
    }

    const isNewGesture = this.#isNewGesture(timeMilliseconds);
    this.#lastCallStartedGesture = isNewGesture;
    if (isNewGesture) {
      this.#device = wheelDevice({pixels, deltaMode, ctrlKey});
    }
    this.#previousEventMilliseconds = timeMilliseconds;

    const rate = this.#device === 'mouse' ? MOUSE_ZOOM_RATE : TRACKPAD_ZOOM_RATE;
    const scale = 2 / (1 + Math.exp(-Math.abs(pixels * rate)));
    let change = Math.log2(scale);
    // Shift key divides the zoom amount for precise control (after device detection).
    if (shiftKey) {
      change = change / SHIFT_PRECISION_DIVISOR;
    }
    // Scroll up (negative pixels) zooms in (positive change).
    return pixels < 0 ? change : -change;
  }

  #isNewGesture(timeMilliseconds) {
    if (this.#previousEventMilliseconds === null) {
      return true;
    }
    return timeMilliseconds - this.#previousEventMilliseconds > GESTURE_GAP_MILLISECONDS;
  }
}

// Clamping the accumulated target, not only the camera, lets the opposite direction respond at once at a limit.
export function clampZoom(zoom, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, zoom));
}

/**
 * Return the LngLat under the pointer so the zoom keeps that location fixed,
 * matching MapLibre scroll zoom behavior.
 */
function pointerLocation(map, event) {
  const canvasContainer = map.getCanvasContainer();
  const canvasRect = canvasContainer.getBoundingClientRect();
  const pointerX = event.clientX - canvasRect.left;
  const pointerY = event.clientY - canvasRect.top;
  return map.unproject({x: pointerX, y: pointerY});
}

/**
 * Ease the map to targetZoom around the given LngLat.
 * Passes the wheel event as originalEvent so movestart carries it (for hasExploredMap).
 * Uses WHEEL_ZOOM_EASE_ID so MapLibre chains consecutive eases into one camera move.
 * Guarantees the camera moves to targetZoom with the specified device's easing.
 */
function easeToTarget(map, targetZoom, aroundPoint, device, event) {
  const isTrackpad = device === 'trackpad';
  map.easeTo({
    zoom: targetZoom,
    around: aroundPoint,
    duration: isTrackpad ? TRACKPAD_EASE_DURATION_MILLISECONDS : MOUSE_EASE_DURATION_MILLISECONDS,
    easing: isTrackpad ? linear : easeOut,
    easeId: WHEEL_ZOOM_EASE_ID,
    // The zoom follows the person's own input, as MapLibre's scroll zoom does under reduced motion. Without this,
    // reduced motion makes every ease instant, which breaks chaining and fires moveend on every wheel event.
    essential: true
  }, {originalEvent: event});
}

/**
 * Install a deterministic wheel-zoom handler on the given MapLibre map.
 * Disables MapLibre's scroll zoom and replaces it with value-based device detection.
 * Returns a cleanup function that removes the listener.
 */
export function installWheelZoom(map) {
  map.scrollZoom.disable();

  const gesture = new WheelZoomGesture();
  // Track the target zoom so rapid events accumulate correctly.
  // When events fire faster than the animation, map.getZoom() has not yet
  // reflected the previous easeTo, so we build on the last target instead.
  let targetZoom = map.getZoom();

  const canvasContainer = map.getCanvasContainer();

  const onWheel = event => {
    event.preventDefault();

    const pixels = wheelPixels({
      deltaY: event.deltaY,
      deltaMode: event.deltaMode
    });

    const change = gesture.zoomChange({
      pixels,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      timeMilliseconds: event.timeStamp,
      shiftKey: event.shiftKey
    });

    // Skip easing when change is 0 (e.g., zero-delta event), but still preventDefault above.
    if (change === 0) {
      return;
    }

    if (gesture.startsGesture) {
      targetZoom = map.getZoom();
    }

    targetZoom = clampZoom(targetZoom + change, map.getMinZoom(), map.getMaxZoom());

    const aroundPoint = pointerLocation(map, event);

    easeToTarget(map, targetZoom, aroundPoint, gesture.device, event);
  };

  const removeListener = () => {
    canvasContainer.removeEventListener('wheel', onWheel);
  };

  canvasContainer.addEventListener('wheel', onWheel, {passive: false});
  map.on('remove', removeListener);

  return removeListener;
}
