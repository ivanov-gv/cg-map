import {test, expect} from '@playwright/test';
import {addUnderCross, applyEdit, centreOn, chooseLayer, exportChangeset, operationsOn, startDrawing, tapAt} from './city-steps.mjs';
import {openFixtureCity} from './fixture-city.mjs';

const isPhone = testInfo => testInfo.project.name === 'pages-mobile';
const outline = [[-2, -4], [0, -4], [0, -2]];

// Draws with the cross on the phone and with the pointer at the desk.
async function drawOutline(page, testInfo) {
  for (const corner of outline) {
    if (isPhone(testInfo)) await addUnderCross(page, corner);
    else await tapAt(page, corner);
  }
  await page.locator('#mode-done').click();
}

test('a sketch and a note travel to the desk, and the sketch is resolved there', {tag: '@phone'}, async ({page}, testInfo) => {
  await openFixtureCity(page);
  await chooseLayer(page, 'green', [2, -3]);
  const tools = page.getByRole('button', {name: 'Tools', exact: true});
  await tools.click();
  await page.getByRole('button', {name: 'Sketch an area'}).click();
  await drawOutline(page, testInfo);
  await page.locator('[name="what"]').selectOption('Playground');
  await page.locator('[name="note"]').fill('Sand and two swings');
  await expect(page.locator('#apply-edit')).toHaveText('Save sketch');
  await page.locator('#apply-edit').click();
  await expect(page.locator('#toast')).toContainText('Sketch saved');
  await centreOn(page, [4, -3]);
  await tapAt(page, [4, -3]);
  await page.locator('#leave-note').click();
  await page.locator('#note-text').fill('The park is bigger');
  await page.locator('#note-save').click();
  await page.locator('#cancel-edit').click();
  await expect(page.locator('#change-count')).toHaveText('2');
  const field = await exportChangeset(page, testInfo);
  expect(field.changeset.operations).toEqual([]);
  expect(field.changeset.fieldItems.map(({type}) => type)).toEqual(['sketch', 'note']);

  // Another device: the exported file arrives under From the field.
  await page.evaluate(() => localStorage.clear());
  await openFixtureCity(page);
  await page.getByRole('button', {name: /^Changes/}).click();
  await page.locator('#review-secondary summary').click();
  await page.locator('#import-changeset').setInputFiles(field.savedPath);
  await expect(page.locator('#field-items')).toContainText('Note on Town park');
  await page.locator('#field-items').getByRole('button', {name: /Playground/}).click();
  await expect(page.locator('#resolve-bar')).toContainText('Sand and two swings');
  await expect(page.locator('#satellite')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status')).toContainText('objects');
  if (isPhone(testInfo)) return;

  await page.locator('#resolve-choices').getByRole('button', {name: 'Draw area'}).click();
  await drawOutline(page, testInfo);
  await page.locator('[name="kind"]').selectOption('playground');
  await expect(page.locator('#apply-edit')).toHaveText('Apply and resolve');
  await applyEdit(page);
  await expect(page.locator('#resolve-bar')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('resolved');
  const desk = await exportChangeset(page, testInfo);
  expect(operationsOn(desk.changeset, 'land.geojson').map(({after}) => after.properties)).toEqual([{kind: 'playground'}]);
  expect(desk.changeset.fieldItems.map(({type}) => type)).toEqual(['note']);
});

test('taking a resolved change back brings its sketch back', async ({page}, testInfo) => {
  test.skip(isPhone(testInfo), 'Sketches are finished at the desk.');
  await openFixtureCity(page);
  await chooseLayer(page, 'water', [0, -3]);
  await page.getByRole('button', {name: 'Tools', exact: true}).click();
  await page.getByRole('button', {name: 'Sketch an area'}).click();
  await drawOutline(page, testInfo);
  await page.locator('[name="what"]').selectOption('Water');
  await page.locator('#apply-edit').click();
  await page.getByRole('button', {name: /^Changes/}).click();
  await page.locator('#field-items').getByRole('button', {name: /Water/}).click();
  await expect(page.locator('#status')).toContainText('objects');
  await startDrawing(page, 'Draw water area');
  await drawOutline(page, testInfo);
  await page.locator('[name="kind"]').selectOption('pond');
  await applyEdit(page);
  await page.locator('#toast-action').click();
  await expect(page.locator('#change-count')).toHaveText('1');
  await expect(page.locator('#field-items li')).toHaveCount(1);
});

// What a phone exports after someone marked the main building for deletion and left a note on the park.
const phoneFile = {
  version: 2,
  id: 'phone',
  createdAt: '2026-11-25T14:20:00.000Z',
  author: 'Field',
  reason: 'Walk',
  bases: {},
  operations: [],
  fieldItems: [
    {
      id: 'local:00000000-0000-4000-8000-000000000001',
      type: 'deletion',
      createdAt: '2026-11-25T14:20:00.000Z',
      layer: 'places',
      geometry: null,
      target: {filename: 'places.geojson', reference: {entityId: 'node/20'}, name: 'Corner cafe'}
    }
  ]
};

test('a mark from the phone is confirmed at the desk, and unrelated work leaves it waiting', async ({page}, testInfo) => {
  test.skip(isPhone(testInfo), 'The desk confirms what the phone marked.');
  await openFixtureCity(page);
  await page.getByRole('button', {name: /^Changes/}).click();
  await page.locator('#review-secondary summary').click();
  const buffer = Buffer.from(JSON.stringify(phoneFile));
  await page.locator('#import-changeset').setInputFiles({name: 'phone.json', mimeType: 'application/json', buffer});
  await page.locator('#field-items').getByRole('button', {name: /Marked for deletion/}).click();
  await expect(page.locator('#resolve-bar')).toBeVisible();
  // Opening it selects the object. Another object of the layer is no answer to the mark.
  await expect(page.locator('#selection-title')).toHaveText('Corner cafe');
  await page.locator('#cancel-edit').click();
  await startDrawing(page, 'Add place');
  await tapAt(page, [3, -3]);
  await expect(page.locator('#apply-edit')).toHaveText('Apply');
  await page.locator('#cancel-edit').click();
  await page.getByRole('button', {name: /^Changes/}).click();
  await page.locator('#field-items').getByRole('button', {name: /Marked for deletion/}).click();
  await expect(page.locator('#apply-edit')).toHaveText('Apply and resolve');
  await page.locator('#delete-feature').click();
  await page.locator('#delete-dialog').getByRole('button', {name: 'Delete'}).click();
  await expect(page.locator('#resolve-bar')).toBeHidden();
  const {changeset} = await exportChangeset(page, testInfo);
  expect(changeset.fieldItems ?? []).toEqual([]);
  expect(operationsOn(changeset, 'places.geojson').map(({operation}) => operation)).toEqual(['delete']);
});
