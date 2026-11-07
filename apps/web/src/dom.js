// Shared DOM construction; application state stays with the owning controllers.
export const elementById = elementId => document.getElementById(elementId);

export function createElement(tag, text, className) {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
}
