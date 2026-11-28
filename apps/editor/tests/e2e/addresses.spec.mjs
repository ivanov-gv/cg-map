import {test, expect} from '@playwright/test';
import {applyEdit, chooseLayer, exportChangeset, operationsOn, tapAt} from './city-steps.mjs';
import {openFixtureCity} from './fixture-city.mjs';

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
