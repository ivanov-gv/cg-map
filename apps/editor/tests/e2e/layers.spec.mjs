import {test, expect} from '@playwright/test';
import {
  addUnderCross,
  applyEdit,
  centreOn,
  chooseLayer,
  dragFromTo,
  exportChangeset,
  operationsOn,
  startDrawing,
  tapAt
} from './city-steps.mjs';
import {openFixtureCity, stepsOf} from './fixture-city.mjs';

const isPhone = testInfo => testInfo.project.name === 'pages-mobile';

test.beforeEach(async ({page}) => {
  await openFixtureCity(page);
});

test('every layer of the wiki can be chosen, one at a time, and the map stays where it is', {tag: '@phone'}, async ({page}) => {
  await centreOn(page, [0, 0]);
  const view = () =>
    page.evaluate(() => [window.editorDebug.map.getCenter().toArray(), window.editorDebug.map.getZoom()]);
  const before = await view();
  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await expect(page.locator('[data-layer]')).toHaveText([
    /^Buildings/,
    /^Addresses/,
    /^Places & points/,
    /^Roads & paths/,
    /^Parks & green/,
    /^Water/,
    /^Relief/,
    /^Settlements & borders/,
    /^Stops/,
    /^Routes/
  ]);
  for (const layerId of ['buildings', 'relief', 'routes']) {
    const layers = page.getByRole('button', {name: 'Layers', exact: true});
    if ((await layers.getAttribute('aria-expanded')) !== 'true') await layers.click();
    await page.locator(`[data-layer="${layerId}"]`).click();
    await expect(page.locator('#status')).toContainText('editable');
    await expect(page.locator('[data-layer][aria-pressed="true"]')).toHaveCount(1);
  }
  expect(await view()).toEqual(before);
});

test('a shape is drawn at the desk, moved, taken back from the toast and deleted with a confirmation', async ({
  page
}, testInfo) => {
  test.skip(isPhone(testInfo), 'The phone draws with a fixed cross and marks for deletion.');
  await chooseLayer(page, 'buildings');
  await startDrawing(page, 'Draw building');
  for (const corner of [[1, -3], [3, -3], [3, -1]]) await tapAt(page, corner);
  await expect(page.locator('#mode-hint')).toContainText('m²');
  await tapAt(page, [1, -1]);
  await page.locator('#mode-undo').click();
  await tapAt(page, [1.5, -1]);
  // A click on the first corner closes the shape, and the inspector opens on it.
  await tapAt(page, [1, -3]);
  await expect(page.locator('#mode-bar')).toBeHidden();
  await expect(page.locator('.inspector')).toBeVisible();
  await applyEdit(page);
  await expect(page.locator('#change-count')).toHaveText('1');
  await page.locator('#toast-action').click();
  await expect(page.locator('#change-count')).toBeHidden();
  await page.getByRole('button', {name: 'Tools', exact: true}).click();
  await page.locator('#redo').click();
  await expect(page.locator('#change-count')).toHaveText('1');
  await page.getByRole('button', {name: 'Tools', exact: true}).click();

  await tapAt(page, [2, 2]);
  await page.locator('#tool-move').click();
  await expect(page.locator('.inspector')).toBeHidden();
  await dragFromTo(page, [2, 2], [3, 2]);
  const ghostCount = () =>
    page.evaluate(() => window.editorDebug.map.queryRenderedFeatures({layers: ['editor-ghost']}).length);
  await expect.poll(ghostCount).toBeGreaterThan(0);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  await expect.poll(ghostCount).toBe(0);

  await tapAt(page, [-2, -2]);
  await page.locator('#delete-feature').click();
  await page.locator('#delete-cancel').click();
  await page.locator('#delete-feature').click();
  await page.locator('#delete-confirm').click();
  await expect(page.locator('#change-count')).toHaveText('3');

  const {changeset} = await exportChangeset(page, testInfo);
  expect(changeset.version).toBe(2);
  const operations = operationsOn(changeset, 'buildings.geojson');
  const operationOf = kind => operations.find(({operation}) => operation === kind);
  expect(operationOf('add').after.geometry.coordinates[0].map(stepsOf)).toEqual([
    [1, -3],
    [3, -3],
    [3, -1],
    [1.5, -1],
    [1, -3]
  ]);
  expect(operationOf('modify').reference).toEqual({entityId: 'way/2'});
  expect(stepsOf(operationOf('modify').after.geometry.coordinates[0][0])).toEqual([2, 1]);
  expect(operationOf('delete').reference).toEqual({entityId: 'way/3'});
});

test('a phone draws with the fixed cross and only marks for deletion', {tag: '@phone'}, async ({page}, testInfo) => {
  test.skip(!isPhone(testInfo), 'The desk draws with the pointer and deletes at once.');
  await chooseLayer(page, 'buildings');
  await startDrawing(page, 'Draw building');
  await expect(page.locator('#map-cross')).toBeVisible();
  for (const corner of [[1, -3], [3, -3], [3, -1]]) await addUnderCross(page, corner);
  await page.locator('#mode-done').click();
  await expect(page.locator('#map-cross')).toBeHidden();
  await applyEdit(page);

  await centreOn(page, [-2, -2]);
  await tapAt(page, [-2, -2]);
  await expect(page.locator('#delete-feature')).toHaveText('Mark for deletion');
  await page.locator('#delete-feature').click();
  await expect(page.locator('#toast')).toContainText('Marked for deletion');
  const markCount = () =>
    page.evaluate(() => window.editorDebug.map.queryRenderedFeatures({layers: ['editor-deletion-line']}).length);
  await expect.poll(markCount).toBeGreaterThan(0);

  const {changeset} = await exportChangeset(page, testInfo);
  const [added] = operationsOn(changeset, 'buildings.geojson');
  expect(added.operation).toBe('add');
  expect(added.after.geometry.coordinates[0].map(stepsOf)).toEqual([
    [1, -3],
    [3, -3],
    [3, -1],
    [1, -3]
  ]);
  expect(changeset.operations).toHaveLength(1);
  expect(changeset.fieldItems.map(({type, target}) => [type, target.reference])).toEqual([
    ['deletion', {entityId: 'way/3'}]
  ]);
});

const boxOf = async locator => {
  await expect(locator).toBeVisible();
  return locator.boundingBox();
};
const areApart = (first, second) =>
  first.x + first.width <= second.x ||
  second.x + second.width <= first.x ||
  first.y + first.height <= second.y ||
  second.y + second.height <= first.y;

test('controls leave each other free on a phone, a tablet and a desktop', async ({page}, testInfo) => {
  test.skip(testInfo.project.name === 'pages-mobile', 'The sizes are set here.');
  await page.evaluate(() => (document.getElementById('offline-notice').hidden = false));
  await chooseLayer(page, 'roads');
  const notice = page.locator('#offline-notice');
  const chip = page.locator('#open-inspector');
  const isFree = async (first, second) => areApart(await boxOf(first), await boxOf(second));
  for (const viewport of [{width: 412, height: 915}, {width: 818, height: 1200}, {width: 1280, height: 800}]) {
    await page.setViewportSize(viewport);
    await centreOn(page, [0, 0]);
    await tapAt(page, [-1, 0]);
    await page.locator('#close-inspector').click();
    await expect.poll(() => isFree(chip, notice), `chip and notice at ${viewport.width} px`).toBe(true);
    await chip.click();
    await page.locator('#tool-vertices').click();
    const modeBar = page.locator('#mode-bar');
    const others = {
      toolbar: page.locator('.workspace-toolbar'),
      layer: page.locator('#current-layer'),
      zoom: page.locator('.maplibregl-ctrl-group').first(),
      notice
    };
    for (const [name, other] of Object.entries(others)) {
      await expect.poll(() => isFree(modeBar, other), `mode bar and ${name} at ${viewport.width} px`).toBe(true);
    }
    await page.locator('#mode-done').click();
    await page.locator('#cancel-edit').click();
  }
});
