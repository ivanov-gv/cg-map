// Small DOM helpers shared by the public app's modules.

export const elementById = id => document.getElementById(id);

// Creates an element with optional text and class in one step, which keeps the render functions readable.
export function createElement(tagName, text, className) {
  const element = document.createElement(tagName);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}

// A live query, so a setting changed during the session applies to the next animation.
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

// Camera animations are instant for people who ask for reduced motion.
export function animationMilliseconds(milliseconds) {
  return reducedMotion.matches ? 0 : milliseconds;
}
