// Determines whether a MapLibre camera event represents a user gesture.
// A camera move made by the application (easeTo, jumpTo, etc.) has no originalEvent.
// User gestures (drag, pinch, wheel) always carry the input event.

/**
 * Returns true when the camera event originated from a user gesture.
 * MapLibre sets originalEvent for user input; programmatic camera moves have none.
 * @param {object} event - A MapLibre camera event (e.g. from 'movestart').
 * @returns {boolean} True if the user initiated the camera move.
 */
export function isUserCameraEvent(event) {
  return event.originalEvent !== undefined;
}
