// What a browser test does in the fixture city, in the words of someone editing it.
import fileSystem from 'node:fs';
import {expect} from '@playwright/test';
import {at, cityCentre} from './fixture-city.mjs';

export async function centreOn(page, [east, north], zoom = 19) {
  await page.evaluate(
    ({center, zoom}) =>
      new Promise(resolve => {
        const {map} = window.editorDebug;
        map.once('idle', resolve);
        map.jumpTo({center, zoom});
      }),
    {center: at(east, north), zoom}
  );
}

export async function chooseLayer(page, layerId, position = [0, 0], zoom = 19) {
  await centreOn(page, position, zoom);
  const layers = page.getByRole('button', {name: 'Layers', exact: true});
  if ((await layers.getAttribute('aria-expanded')) !== 'true') await layers.click();
  await page.locator(`[data-layer="${layerId}"]`).click();
  await expect(page.locator('#status')).toContainText('objects');
}

// Where a place of the city is on the screen, with whatever covers it out of the way.
export async function screenPoint(page, [east, north]) {
  return page.evaluate(coordinate => {
    const {map} = window.editorDebug;
    const {x, y} = map.project(coordinate);
    const bounds = map.getCanvas().getBoundingClientRect();
    return {x: bounds.left + x, y: bounds.top + y};
  }, at(east, north));
}

// Taps wait until the layer has drawn, as the editor itself ignores taps on a layer still loading.
export async function tapAt(page, position, options = {}) {
  await expect(page.locator('#status')).not.toContainText('Loading');
  const {x, y} = await screenPoint(page, position);
  await page.mouse.click(x, y, options);
}

// Starts editing corners, once their handles can be grabbed.
export async function editCorners(page) {
  await page.locator('#tool-vertices').click();
  const handleCount = () =>
    page.evaluate(() => window.editorDebug.map.queryRenderedFeatures({layers: ['editor-handles-point']}).length);
  await expect.poll(handleCount).toBeGreaterThan(0);
}

export async function dragFromTo(page, from, to) {
  const start = await screenPoint(page, from);
  const end = await screenPoint(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, {steps: 5});
  await page.mouse.up();
}

// Draws through these places with the fixed cross of the phone.
export async function addUnderCross(page, position) {
  await page.evaluate(center => window.editorDebug.map.jumpTo({center}), at(...position));
  await page.locator('#mode-add').click();
}

export async function startDrawing(page, label) {
  const tools = page.getByRole('button', {name: 'Tools', exact: true});
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click();
  await page.locator('#draw-choices').getByRole('button', {name: label, exact: true}).click();
  await expect(page.locator('#mode-bar')).toBeVisible();
}

export async function applyEdit(page) {
  await page.locator('#apply-edit').click();
  await expect(page.locator('.inspector')).toBeHidden();
  await expect(page.locator('#status')).toContainText('objects');
}

// The exported changeset, as a desk or the importer would receive it.
export async function exportChangeset(page, testInfo) {
  const changes = page.getByRole('button', {name: /^Changes/});
  if ((await changes.getAttribute('aria-expanded')) !== 'true') await changes.click();
  await page.locator('#export-changeset').click();
  await page.locator('#changeset-author').fill('Browser Test');
  await page.locator('#changeset-reason').fill('Acceptance test');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#confirm-export').click();
  const download = await downloadPromise;
  const savedPath = testInfo.outputPath(download.suggestedFilename());
  await download.saveAs(savedPath);
  return {savedPath, changeset: JSON.parse(fileSystem.readFileSync(savedPath))};
}

export const operationsOn = (changeset, filename) =>
  changeset.operations.filter(operation => operation.filename === filename);

export {cityCentre};
