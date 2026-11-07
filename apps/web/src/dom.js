// Shared DOM construction and preference queries; application state stays with the owning controllers.
export const elementById = elementId => document.getElementById(elementId);

export function createElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

// Callers choose when to read the preference: startup captures it, route framing reads it for each move.
export function isReducedMotionPreferred() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}
