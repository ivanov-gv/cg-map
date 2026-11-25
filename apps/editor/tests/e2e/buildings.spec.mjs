import {test, expect} from '@playwright/test';
import {applyEdit, chooseLayer, dragFromTo, exportChangeset, operationsOn, startDrawing, tapAt} from './city-steps.mjs';
import {openFixtureCity, stepsOf} from './fixture-city.mjs';

test.beforeEach(async ({page}, testInfo) => {
  test.skip(testInfo.project.name === 'pages-mobile', 'The phone differences are in layers.spec.');
  await openFixtureCity(page);
  await chooseLayer(page, 'buildings');
});

test('a building is drawn, described, given an entrance and a place, and exported whole', async ({page}, testInfo) => {
  await startDrawing(page, 'Draw building');
  for (const corner of [[1, -3], [3, -3], [3, -1], [1, -1]]) await tapAt(page, corner);
  await page.locator('#mode-done').click();
  await expect(page.locator('#inspector-extras')).toContainText('Not on the map until you apply it');
  await page.locator('[data-list-for="building:levels"]').selectOption('3');
  await page.locator('[name="energy_class"]').selectOption('B');
  await page.getByRole('button', {name: 'Add address'}).click();
  await page.keyboard.type('16');
  await applyEdit(page);
  await expect(page.locator('#change-count')).toHaveText('2');

  await tapAt(page, [2, -2]);
  await page.getByRole('button', {name: 'Add entrance'}).click();
  // Below the building: the door goes to the nearest point of the outline.
  await tapAt(page, [2, -3.6]);
  await expect(page.locator('[name="ref"]')).toHaveValue('1');
  await page.locator('[name="opens_onto"]').selectOption('courtyard');
  await applyEdit(page);

  await tapAt(page, [2, -2]);
  await page.getByRole('button', {name: 'Add place'}).click();
  await page.locator('[name="name"]').fill('New barber');
  await page.locator('[name="category"]').selectOption('shops');
  await page.locator('[name="kind"]').fill('hairdresser');
  await page.locator('[name="visibilityLevel"]').selectOption('4');
  await applyEdit(page);
  await tapAt(page, [2.4, -1.4]);
  await expect(page.locator('#inspector-extras')).toContainText('Entrances · 1');
  await expect(page.locator('#inspector-extras')).toContainText('New barber');
  await page.locator('#cancel-edit').click();

  const {changeset} = await exportChangeset(page, testInfo);
  const [building] = operationsOn(changeset, 'buildings.geojson');
  const [label] = operationsOn(changeset, 'building-labels.geojson');
  const [entrance] = operationsOn(changeset, 'building-entrances.geojson');
  const [place] = operationsOn(changeset, 'places.geojson');
  const buildingId = building.reference.localId;
  expect(building.after.properties).toMatchObject({'building:levels': '3', energy_class: 'B'});
  expect(label.after.properties).toMatchObject({'addr:housenumber': '16', buildingEntityId: buildingId});
  expect(entrance.after.properties).toMatchObject({buildingEntityId: buildingId, opens_onto: 'courtyard'});
  expect(stepsOf(entrance.after.geometry.coordinates)).toEqual([2, -3]);
  expect(place.after.properties).toMatchObject({buildingEntityId: buildingId, name: 'New barber'});
});

test('a moved building takes everything with it in one step, and its removal asks about the place inside', async ({
  page
}, testInfo) => {
  await tapAt(page, [-1.4, 1.4]);
  await expect(page.locator('#selection-title')).toHaveText('Main street 14');
  await page.locator('#tool-move').click();
  await dragFromTo(page, [-2, 2], [-2, 3]);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  await expect(page.locator('#change-count')).toHaveText('4');
  await expect(page.locator('#review-problems')).toBeEmpty();
  await page.locator('#toast-action').click();
  await expect(page.locator('#change-count')).toBeHidden();

  await tapAt(page, [-1.4, 1.4]);
  await page.locator('#delete-feature').click();
  await expect(page.locator('#delete-message')).toContainText('Corner cafe');
  await page.locator('#delete-confirm').click();
  await expect(page.locator('#mode-title')).toHaveText('Pick the building the places move to');
  await tapAt(page, [2, 2]);
  await expect(page.locator('#change-count')).toHaveText('4');
  const {changeset} = await exportChangeset(page, testInfo);
  expect(changeset.operations.map(({filename, operation}) => [filename, operation]).toSorted()).toEqual([
    ['building-entrances.geojson', 'delete'],
    ['building-labels.geojson', 'delete'],
    ['buildings.geojson', 'delete'],
    ['places.geojson', 'modify']
  ]);
  const [place] = operationsOn(changeset, 'places.geojson');
  expect(place.after.properties.buildingEntityId).toBe('way/2');
});
