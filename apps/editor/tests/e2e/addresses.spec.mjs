import {test, expect} from '@playwright/test';
import {applyEdit, chooseLayer, dragFromTo, exportChangeset, operationsOn, startDrawing, tapAt} from './city-steps.mjs';
import {openFixtureCity, stepsOf} from './fixture-city.mjs';

test.beforeEach(async ({page}, testInfo) => {
  test.skip(testInfo.project.name === 'pages-mobile', 'The phone takes the same path through these forms.');
  await openFixtureCity(page);
});

test('an address takes a street from the roads, and gaps are filled one after another', async ({page}, testInfo) => {
  await chooseLayer(page, 'addresses');
  await tapAt(page, [-2, 2]);
  await expect(page.locator('#selection-title')).toHaveText('Main street 14');
  await page.locator('[name="addr:housenumber"]').fill('bb');
  await page.locator('#apply-edit').click();
  await expect(page.locator('#edit-problem')).toContainText('placeholder');
  await page.locator('[name="addr:housenumber"]').fill('14a');
  await page.getByRole('button', {name: 'Choose'}).click();
  await page.locator('#street-search').fill('side');
  await page.locator('#street-list').getByRole('button', {name: /Side street/}).click();
  await expect(page.locator('[name="addr:street"]')).toHaveValue('Side street');
  await applyEdit(page);

  await page.getByRole('button', {name: 'Tools', exact: true}).click();
  await page.getByRole('button', {name: 'Fill the gaps'}).click();
  await expect(page.locator('#status')).toHaveText('Buildings without a number · 2 objects');
  await tapAt(page, [2, 2]);
  await expect(page.locator('#apply-edit')).toHaveText('Save and next');
  await page.locator('[name="addr:housenumber"]').fill('16');
  await page.keyboard.press('Enter');
  // The form of the next building without a number opens by itself.
  await expect(page.locator('#selection-source')).toHaveText('buildings.geojson · feature 2');
  await page.locator('[name="nohousenumber"]').check();
  await page.locator('#apply-edit').click();
  await expect(page.locator('#toast')).toContainText('No more buildings');

  const {changeset} = await exportChangeset(page, testInfo);
  const labels = operationsOn(changeset, 'building-labels.geojson');
  const changedLabel = labels.find(({operation}) => operation === 'modify');
  const addedLabel = labels.find(({operation}) => operation === 'add');
  expect(changedLabel.after.properties).toMatchObject({'addr:housenumber': '14a', 'addr:street': 'Side street'});
  expect(addedLabel.after.properties).toMatchObject({'addr:housenumber': '16', buildingEntityId: 'way/2'});
  const buildings = operationsOn(changeset, 'buildings.geojson').map(({reference, after}) => [
    reference.entityId,
    after.properties['addr:housenumber'] ?? after.properties.nohousenumber
  ]);
  expect(Object.fromEntries(buildings)).toEqual({'way/1': '14a', 'way/2': '16', 'way/3': 'yes'});
});

test('a place is added with its hours and belongs to the building it is moved onto', async ({page}, testInfo) => {
  await chooseLayer(page, 'places');
  await startDrawing(page, 'Add place');
  await tapAt(page, [0, 2]);
  await expect(page.locator('#inspector-extras')).toContainText('Stands on its own');
  await page.locator('[name="name"]').fill('New bakery');
  await page.locator('[name="category"]').selectOption('food');
  await page.locator('[name="kind"]').fill('bakery');
  await page.locator('[name="visibilityLevel"]').selectOption('4');
  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  await page.getByRole('button', {name: 'Weekdays + weekend'}).click();
  await expect(page.locator('#hours-stored')).toHaveText('Mo-Fr 08:00-20:00; Sa-Su 10:00-18:00');
  await page.locator('#hours-dialog').getByLabel('Closes at').first().fill('22:00');
  await page.locator('#hours-dialog').getByLabel('Closes at').first().blur();
  await page.locator('#hours-dialog').getByLabel('Holidays').last().check();
  await page.locator('#hours-done').click();
  await expect(page.locator('[name="opening_hours"]')).toHaveValue('Mo-Fr 08:00-22:00; Sa-Su,PH 10:00-18:00');

  await page.locator('#tool-move').click();
  await dragFromTo(page, [0, 2], [2, 2]);
  await expect(page.locator('#mode-hint')).toContainText('Inside a building');
  const targetCount = () =>
    page.evaluate(() => window.editorDebug.map.queryRenderedFeatures({layers: ['editor-target']}).length);
  await expect.poll(targetCount).toBeGreaterThan(0);
  await page.locator('#mode-done').click();
  await applyEdit(page);

  const {changeset} = await exportChangeset(page, testInfo);
  const [place] = operationsOn(changeset, 'places.geojson');
  expect(place.after.properties).toMatchObject({
    name: 'New bakery',
    buildingEntityId: 'way/2',
    opening_hours: 'Mo-Fr 08:00-22:00; Sa-Su,PH 10:00-18:00'
  });
  expect(place.after.properties.standalone).toBeUndefined();
  expect(stepsOf(place.after.geometry.coordinates)).toEqual([2, 2]);
});
