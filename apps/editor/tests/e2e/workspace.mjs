// How a browser test finds its way around the workspace. Tests name the source file they care about; the layer that
// holds it is an implementation detail of these helpers.
import {editorLayers, layerIdOfFile} from '../../src/layers/shared/editor-layers.js';

export const browseStatus = 'Browse · choose a layer to edit';

const layerOfFile = filename => editorLayers.find(({id}) => id === layerIdOfFile(filename));

export const layerNameOf = filename => layerOfFile(filename).name;

export const layerButton = (page, filename) => page.locator(`[data-layer="${layerIdOfFile(filename)}"]`);

// The first thing that can be added on the active layer.
export const drawChoice = page => page.locator('#draw-choices button').first();

// Ends a move or corner mode, if one is open, so that the inspector and its Apply are back.
export async function leaveMode(page) {
  const done = page.locator('#mode-done');
  if (await done.isVisible()) await done.click();
}

// Shrinks the inspector to a mode, opening it first where the test collapsed it.
export async function startMode(page, toolId) {
  const opener = page.locator('#open-inspector');
  if (await opener.isVisible()) await opener.click();
  await page.locator(`#${toolId}`).click();
}

export async function openTools(page) {
  const tools = page.getByRole('button', {name: 'Tools', exact: true});
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click();
}

// With a key, the list opens as a keyboard user would open it.
export async function openObjects(page, key = null) {
  await openTools(page);
  const opener = page.locator('#open-objects');
  if (!key) {
    await opener.click();
    return;
  }
  await opener.focus();
  await page.keyboard.press(key);
}

// On a phone an object is only marked; at the desk the deletion is confirmed at once.
export async function deleteObject(page) {
  await page.locator('#delete-feature').click();
  const confirm = page.locator('#delete-confirm');
  if (await confirm.isVisible()) await confirm.click();
}
