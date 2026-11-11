import test from 'node:test';
import assert from 'node:assert/strict';
import {wheelPixels, wheelDevice, WheelZoomGesture, clampZoom} from '../src/wheel-zoom.js';

// Firefox and Chrome on macOS report this exact value per mouse wheel notch.
const MOUSE_WHEEL_QUANTUM = 4.000244140625;
// Chrome reports one notch as 120 pixels on Linux; 120 is not a multiple of the macOS quantum.
const MOUSE_NOTCH_PIXELS = 120;

/**
 * Return the total zoom change for three mouse notches spaced by the given milliseconds.
 */
function totalZoomForNotches(spacingMilliseconds) {
  const gesture = new WheelZoomGesture();
  let total = 0;
  for (let notchIndex = 0; notchIndex < 3; notchIndex++) {
    const change = gesture.zoomChange({
      pixels: -MOUSE_NOTCH_PIXELS,
      deltaMode: 0,
      ctrlKey: false,
      timeMilliseconds: 1000 + notchIndex * spacingMilliseconds
    });
    total += change;
  }
  return total;
}

test('wheelPixels converts delta modes correctly', () => {
  // Pixel mode passes through unchanged.
  assert.equal(wheelPixels({deltaY: 120, deltaMode: 0}), 120);
  // Line mode multiplies by 40.
  assert.equal(wheelPixels({deltaY: 3, deltaMode: 1}), 120);
  // Page mode multiplies by 800.
  assert.equal(wheelPixels({deltaY: 1, deltaMode: 2}), 800);
});

test('wheelDevice classifies input by value, not timing', () => {
  // Line mode is always mouse.
  assert.equal(wheelDevice({pixels: 120, deltaMode: 1, ctrlKey: false}), 'mouse');
  // Page mode is always mouse.
  assert.equal(wheelDevice({pixels: 800, deltaMode: 2, ctrlKey: false}), 'mouse');
  // ctrlKey indicates trackpad pinch (browsers report this on every OS).
  assert.equal(wheelDevice({pixels: 120, deltaMode: 0, ctrlKey: true}), 'trackpad');
  // 120 px is mouse by the large-delta threshold.
  assert.equal(wheelDevice({pixels: MOUSE_NOTCH_PIXELS, deltaMode: 0, ctrlKey: false}), 'mouse');
  // Small multiple of the quantum is still mouse.
  assert.equal(wheelDevice({pixels: MOUSE_WHEEL_QUANTUM, deltaMode: 0, ctrlKey: false}), 'mouse');
  // Large pixel value is mouse.
  assert.equal(wheelDevice({pixels: 100, deltaMode: 0, ctrlKey: false}), 'mouse');
  // Small arbitrary float is trackpad.
  assert.equal(wheelDevice({pixels: 3.7, deltaMode: 0, ctrlKey: false}), 'trackpad');
  // Very small trackpad delta.
  assert.equal(wheelDevice({pixels: 1.2, deltaMode: 0, ctrlKey: false}), 'trackpad');
});

test('three mouse notches give the same total zoom regardless of event spacing', () => {
  // Regression test: when events arrive 0-1 ms apart, MapLibre mislabels the
  // mouse as a trackpad. Our implementation must not depend on timing.
  const totalAtZeroMilliseconds = totalZoomForNotches(0);
  const totalAtOneMillisecond = totalZoomForNotches(1);
  const totalAtThirtyMilliseconds = totalZoomForNotches(30);

  // All three spacings must produce the same total zoom.
  assert.equal(totalAtZeroMilliseconds, totalAtOneMillisecond, '0 ms and 1 ms apart should zoom the same');
  assert.equal(totalAtOneMillisecond, totalAtThirtyMilliseconds, '1 ms and 30 ms apart should zoom the same');

  // The total should be a reasonable mouse zoom (around 0.57 for 3 notches).
  assert.ok(totalAtZeroMilliseconds > 0.5, `Expected mouse zoom around 0.57, got ${totalAtZeroMilliseconds}`);
  assert.ok(totalAtZeroMilliseconds < 0.7, `Expected mouse zoom around 0.57, got ${totalAtZeroMilliseconds}`);
});

test('small trackpad delta stays trackpad for the whole gesture', () => {
  const gesture = new WheelZoomGesture();

  // First event: small trackpad delta.
  const firstChange = gesture.zoomChange({
    pixels: -3.7,
    deltaMode: 0,
    ctrlKey: false,
    timeMilliseconds: 1000
  });

  // Second event: still small, within the same gesture.
  const secondChange = gesture.zoomChange({
    pixels: -3.7,
    deltaMode: 0,
    ctrlKey: false,
    timeMilliseconds: 1016
  });

  // Both should use the trackpad rate (1/100), producing larger zoom per pixel
  // than the mouse rate (1/450). Trackpad zoom for 3.7 px is about 0.026 per event.
  assert.ok(firstChange > 0.02, `Trackpad zoom should be ~0.026, got ${firstChange}`);
  assert.ok(secondChange > 0.02, `Trackpad zoom should be ~0.026, got ${secondChange}`);
  // The two events should produce the same change (same device, same pixels).
  assert.equal(firstChange, secondChange, 'Same pixels should give same zoom within a gesture');
});

test('ctrl+wheel is classified as trackpad', () => {
  const gesture = new WheelZoomGesture();

  const change = gesture.zoomChange({
    pixels: -120,
    deltaMode: 0,
    ctrlKey: true,
    timeMilliseconds: 1000
  });

  // ctrl+wheel uses trackpad rate, so 120 pixels produces a larger zoom
  // than the mouse rate would. Trackpad: ~0.64, Mouse: ~0.19.
  assert.ok(change > 0.3, `ctrl+wheel should use trackpad rate, got ${change}`);
});

test('400+ ms pause starts a new gesture with re-detected device', () => {
  const gesture = new WheelZoomGesture();

  // First event: mouse notch.
  const firstChange = gesture.zoomChange({
    pixels: -MOUSE_NOTCH_PIXELS,
    deltaMode: 0,
    ctrlKey: false,
    timeMilliseconds: 1000
  });

  // Long pause, then a small trackpad-like delta.
  // The device should re-detect as trackpad for this new gesture.
  const secondChange = gesture.zoomChange({
    pixels: -3.7,
    deltaMode: 0,
    ctrlKey: false,
    timeMilliseconds: 1500 // 500 ms later -> new gesture
  });

  // First event uses mouse rate (quantum multiple).
  assert.ok(firstChange > 0, 'Mouse notch should zoom in');

  // Second event uses trackpad rate (small arbitrary float, new gesture).
  // Trackpad rate for 3.7 px is about 0.026.
  assert.ok(secondChange > 0.02, `Trackpad delta after pause should use trackpad rate, got ${secondChange}`);
});

test('scrolling up (negative pixels) zooms in (positive change)', () => {
  const gesture = new WheelZoomGesture();

  const changeDown = gesture.zoomChange({
    pixels: MOUSE_NOTCH_PIXELS,
    deltaMode: 0,
    ctrlKey: false,
    timeMilliseconds: 1000
  });

  const gestureForScrollUp = new WheelZoomGesture();
  const changeUp = gestureForScrollUp.zoomChange({
    pixels: -MOUSE_NOTCH_PIXELS,
    deltaMode: 0,
    ctrlKey: false,
    timeMilliseconds: 1000
  });

  assert.ok(changeDown < 0, 'Scroll down should zoom out (negative change)');
  assert.ok(changeUp > 0, 'Scroll up should zoom in (positive change)');
  assert.equal(Math.abs(changeDown), Math.abs(changeUp), 'Same magnitude for same |pixels|');
});

test('line mode wheel is classified as mouse', () => {
  const gesture = new WheelZoomGesture();

  const change = gesture.zoomChange({
    pixels: -120,
    deltaMode: 1,
    ctrlKey: false,
    timeMilliseconds: 1000
  });

  // Line mode is always mouse, so it uses the mouse rate (1/450).
  // 120 pixels at mouse rate gives about 0.19 zoom levels.
  assert.ok(change > 0, 'Scroll up should zoom in');
  assert.ok(change < 0.3, `Line mode should use mouse rate (~0.19), got ${change}`);
});

test('a gesture starting with a mouse notch stays mouse when a later event is small', () => {
  // The device label is fixed for the gesture: a small pixel value later in the
  // same gesture must not reclassify the input as trackpad.
  const gesture = new WheelZoomGesture();

  // First event: clear mouse notch.
  gesture.zoomChange({
    pixels: -MOUSE_NOTCH_PIXELS,
    deltaMode: 0,
    ctrlKey: false,
    timeMilliseconds: 1000
  });
  assert.equal(gesture.device, 'mouse');

  // Second event: small 2 px delta within the same gesture (16 ms later).
  const change = gesture.zoomChange({
    pixels: -2,
    deltaMode: 0,
    ctrlKey: false,
    timeMilliseconds: 1016
  });

  // Device must remain mouse; the change uses the mouse rate (1/450).
  assert.equal(gesture.device, 'mouse', 'Device should stay mouse for the whole gesture');
  // Mouse rate for 2 px is tiny (~0.003); trackpad rate would be ~0.014.
  assert.ok(change < 0.01, `Should use mouse rate, got ${change}`);
});

test('clampZoom keeps the zoom within the allowed range', () => {
  assert.equal(clampZoom(10, 0, 20), 10);
  assert.equal(clampZoom(-2, 0, 20), 0);
  assert.equal(clampZoom(25, 0, 20), 20);
  assert.equal(clampZoom(0, 0, 20), 0);
  assert.equal(clampZoom(20, 0, 20), 20);
});

test('shifted notch zooms less than a plain notch', () => {
  // Shift key should divide the zoom amount by 4 after device detection.
  const gesturePlain = new WheelZoomGesture();
  const changePlain = gesturePlain.zoomChange({
    pixels: -MOUSE_NOTCH_PIXELS,
    deltaMode: 0,
    ctrlKey: false,
    timeMilliseconds: 1000,
    shiftKey: false
  });

  const gestureShifted = new WheelZoomGesture();
  const changeShifted = gestureShifted.zoomChange({
    pixels: -MOUSE_NOTCH_PIXELS,
    deltaMode: 0,
    ctrlKey: false,
    timeMilliseconds: 1000,
    shiftKey: true
  });

  // Both should classify as mouse (120 px is above LARGE_SCROLL_THRESHOLD).
  assert.equal(gesturePlain.device, 'mouse');
  assert.equal(gestureShifted.device, 'mouse');

  // Shifted zoom must be smaller than plain zoom.
  assert.ok(
    Math.abs(changeShifted) < Math.abs(changePlain),
    `Shifted notch (${changeShifted}) should zoom less than plain notch (${changePlain})`
  );

  // Shifted zoom should be roughly 1/4 of the plain zoom.
  const ratio = Math.abs(changePlain) / Math.abs(changeShifted);
  assert.ok(
    ratio > 3 && ratio < 5,
    `Shift divisor should be ~4, got ratio ${ratio}`
  );
});

test('zero-delta event followed by a notch zooms like a plain notch', () => {
  // A zero deltaY must not start or label a gesture, and must not update timing.
  // The following 120 px notch should behave as a fresh gesture.
  const gesture = new WheelZoomGesture();

  // Zero-delta event (e.g., Chrome sends shift+wheel as deltaX only).
  const zeroChange = gesture.zoomChange({
    pixels: 0,
    deltaMode: 0,
    ctrlKey: false,
    timeMilliseconds: 1000,
    shiftKey: false
  });
  assert.equal(zeroChange, 0, 'Zero delta must return 0');
  assert.equal(gesture.device, null, 'Zero delta must not set a device');

  // 120 px notch 10 ms later — should start a new gesture and zoom normally.
  const notchChange = gesture.zoomChange({
    pixels: -MOUSE_NOTCH_PIXELS,
    deltaMode: 0,
    ctrlKey: false,
    timeMilliseconds: 1010,
    shiftKey: false
  });
  assert.ok(notchChange > 0, 'Notch after zero delta should zoom in');
  assert.equal(gesture.device, 'mouse', 'Notch should classify as mouse');
  assert.ok(gesture.startsGesture, 'Notch after zero delta should start a gesture');
});
