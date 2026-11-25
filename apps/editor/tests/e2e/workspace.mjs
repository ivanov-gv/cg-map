// How a browser test finds its way around the workspace. Tests name the source file they care about; the layer that
// holds it is an implementation detail of these helpers.
export const browseStatus = 'Browse · choose a layer to edit';

const layerIdByFile = {
  'buildings.geojson': 'buildings',
  'building-labels.geojson': 'addresses',
  'places.geojson': 'places',
  'roads.geojson': 'roads',
  'land.geojson': 'green',
  'water.geojson': 'water',
  'context-countries.geojson': 'settlements',
  'transport-stops.geojson': 'stops'
};
const layerNames = {
  buildings: 'Buildings',
  addresses: 'Addresses',
  places: 'Places & points',
  roads: 'Roads & paths',
  green: 'Parks & green',
  water: 'Water',
  settlements: 'Settlements & borders',
  stops: 'Stops'
};

export const layerNameOf = filename => layerNames[layerIdByFile[filename]];

export const layerButton = (page, filename) => page.locator(`[data-layer="${layerIdByFile[filename]}"]`);

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
