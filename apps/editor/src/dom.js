export const elementById = id => document.getElementById(id);

// Creates an element with its text in one step, which keeps the render functions readable.
export function createElementWithText(tagName, text) {
  const element = document.createElement(tagName);
  element.textContent = text;
  return element;
}

// Offers a value as a JSON file. Exports go through the browser's download, so nothing can write a source file.
export function downloadJSON(filename, value) {
  const blob = new Blob([JSON.stringify(value, null, 2) + '\n'], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
