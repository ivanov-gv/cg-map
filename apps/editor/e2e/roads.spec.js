import {test, expect} from '@playwright/test';
import {
  applyEdit,
  centreOn,
  chooseLayer,
  editCorners,
  exportChangeset,
  operationsOn,
  startDrawing,
  tapAt,
  waitForRepaint
} from '../tests/e2e/city-steps.mjs';
import {openFixtureCity, stepsOf} from '../tests/e2e/fixture-city.mjs';

const jointStatusesOnMap = page =>
  page.evaluate(async () => {
    const {features} = await window.editorDebug.map.getSource('editor-joints').getData();
    return features.map(({properties}) => properties.status).sort();
  });

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
  await page.getByRole('button', {name: 'Close'}).first().click();
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

  // The host still passes the shown level to the real joint and pick helpers.
  await tapAt(page, [-3, 0]);
  await page.locator('[name="layer"]').evaluate(select => select.closest('details').setAttribute('open', ''));
  await page.locator('[name="layer"]').selectOption('-1');
  await applyEdit(page);
  const picker = page.locator('#level-picker');
  await picker.getByRole('button', {name: 'Level -1'}).click();
  await expect(picker.getByRole('button', {name: 'Level -1'})).toHaveAttribute('aria-pressed', 'true');
  const belowGroundJoints = await jointStatusesOnMap(page);
  // The directory follows the shown level: it lists Main street but offers no ground road at Level -1.
  const tools = page.getByRole('button', {name: 'Tools', exact: true});
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click();
  await page.locator('#open-objects').click();
  await expect(page.locator('#objects-list')).toContainText('Main street');
  await expect(page.locator('#objects-list')).not.toContainText('Side street');
  await page.locator('#objects-panel [data-close-panel]').click();
  // A road on the ground cannot be picked while the level below is shown.
  await tapAt(page, [6, 2]);
  await expect(page.locator('.inspector')).toBeHidden();
  await picker.getByRole('button', {name: 'All levels'}).click();
  await expect.poll(() => jointStatusesOnMap(page)).not.toEqual(belowGroundJoints);
  await waitForRepaint(page);
  await tapAt(page, [6, 2]);
  await expect(page.locator('#selection-title')).toHaveText('Side street');
  // A joint is picked before the road under it.
  await centreOn(page, [6, 0]);
  await tapAt(page, [6, 0]);
  await expect(page.locator('#selection-kind')).toHaveText('Junction');
  await expect(page.locator('#selection-title')).toHaveText('Main street × Side street');
});
