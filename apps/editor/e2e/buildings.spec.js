import {test, expect} from '@playwright/test';
import {
  applyEdit,
  chooseLayer,
  exportChangeset,
  operationsOn,
  startDrawing,
  tapAt
} from '../tests/e2e/city-steps.mjs';
import {openFixtureCity, stepsOf} from '../tests/e2e/fixture-city.mjs';

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
  await expect(page.locator('#review-problems')).toBeEmpty();

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

  // The whole app still saves its draft and comes back in Browse after a reload.
  await page.reload();
  await expect(page.locator('#status')).toContainText('Browse');
  await chooseLayer(page, 'buildings');

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
