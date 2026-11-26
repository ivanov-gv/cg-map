import {test, expect} from '@playwright/test';
import {applyEdit, chooseLayer, editCorners, exportChangeset, operationsOn, startDrawing, tapAt} from '../tests/e2e/city-steps.mjs';
import {openFixtureCity, stepsOf} from '../tests/e2e/fixture-city.mjs';

test.beforeEach(async ({page}, testInfo) => {
  test.skip(testInfo.project.name === 'pages-mobile', 'The road graph and joining are desk work.');
  await openFixtureCity(page);
  await chooseLayer(page, 'roads');
});

test('a path drawn onto a street joins it, a street is split and joined again', async ({page}, testInfo) => {
  await startDrawing(page, 'Draw path');
  // Near the street: the click joins it there.
  await tapAt(page, [2, 0.05]);
  await tapAt(page, [2, 2]);
  await page.locator('#mode-done').click();
  await expect(page.locator('#edit-facts')).toContainText('Length');
  await applyEdit(page);

  await tapAt(page, [-3, 0]);
  await expect(page.locator('#selection-title')).toHaveText('Main street');
  await editCorners(page);
  await tapAt(page, [0, 0]);
  await page.locator('#vertex-split').click();
  await expect(page.locator('#change-count')).toHaveText('3');
  await tapAt(page, [-3, 0]);
  await page.getByRole('button', {name: 'Join roads'}).click();
  // The path meets neither end, and the refusal is on screen with the edit it is about.
  await tapAt(page, [2, 1]);
  await expect(page.locator('#edit-problem')).toBeVisible();
  await expect(page.locator('#edit-problem')).toContainText('do not meet end to end');
  await page.getByRole('button', {name: 'Join roads'}).click();
  await tapAt(page, [4, 0]);
  await expect(page.locator('#change-count')).toHaveText('2');

  const {changeset} = await exportChangeset(page, testInfo);
  const operations = operationsOn(changeset, 'roads.geojson');
  const path = operations.find(({operation}) => operation === 'add');
  const street = operations.find(({operation}) => operation === 'modify');
  expect(path.after.geometry.coordinates.map(stepsOf)).toEqual([
    [2, 0],
    [2, 2]
  ]);
  expect(street.reference).toEqual({entityId: 'way/30'});
  expect(street.after.geometry.coordinates.map(stepsOf)).toEqual([
    [-6, 0],
    [0, 0],
    [2, 0],
    [6, 0]
  ]);
});
