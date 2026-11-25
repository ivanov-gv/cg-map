import {test, expect} from '@playwright/test';
import {
  applyEdit,
  centreOn,
  chooseLayer,
  dragFromTo,
  editCorners,
  exportChangeset,
  operationsOn,
  startDrawing,
  tapAt
} from './city-steps.mjs';
import {openFixtureCity, stepsOf} from './fixture-city.mjs';

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

test('a road gets its access, and its ends open the junctions they are at', async ({page}, testInfo) => {
  await tapAt(page, [-3, 0]);
  await expect(page.locator('.end-row')).toHaveText([/A.*Dead end/s, /B.*Joins Side street/s]);
  await page.locator('[name="motor_vehicle"]').selectOption('no');
  await page.getByText('More', {exact: true}).click();
  await page.locator('[name="smoothness"]').selectOption('very_bad');
  await page.locator('[name="kind"]').selectOption('pedestrian');
  // An open edit is not lost to a look at the junction.
  await page.getByRole('button', {name: 'Open the junction at B'}).click();
  await expect(page.locator('#edit-problem')).toContainText('Apply or Cancel');
  await applyEdit(page);
  await tapAt(page, [-3, 0]);
  await page.getByRole('button', {name: 'Open the junction at B'}).click();
  await expect(page.locator('#selection-kind')).toHaveText('Junction');
  await page.getByLabel('What stands here').selectOption('traffic_signals');
  await applyEdit(page);
  const {changeset} = await exportChangeset(page, testInfo);
  const [road] = operationsOn(changeset, 'roads.geojson');
  const [light] = operationsOn(changeset, 'road-nodes.geojson');
  expect(road.after.properties).toMatchObject({kind: 'pedestrian', motor_vehicle: 'no', smoothness: 'very_bad'});
  expect(light.after.properties).toEqual({kind: 'traffic_signals'});
  expect(stepsOf(light.after.geometry.coordinates)).toEqual([6, 0]);
});

const statusesOnMap = page =>
  page.evaluate(async () => {
    const {features} = await window.editorDebug.map.getSource('editor-joints').getData();
    return features.map(({properties}) => properties.status).sort();
  });

test('joints are shown, and a junction is opened, given a turn rule, disconnected and joined again', async ({page}, testInfo) => {
  // Main and Side street meet at one end; their other ends and both of Far street are dead ends.
  await centreOn(page, [0, 0], 17.5);
  await expect.poll(() => statusesOnMap(page)).toEqual(['deadEnd', 'deadEnd', 'deadEnd', 'deadEnd', 'joined']);
  await centreOn(page, [5, 2]);
  await tapAt(page, [6, 0]);
  await expect(page.locator('#selection-title')).toHaveText('Main street × Side street');
  await page.getByText('From Main street, west').click();
  await page.getByLabel(/Left onto Side street/).uncheck();
  await applyEdit(page);
  await tapAt(page, [6, 0]);
  await page.getByText('From Main street, west').click();
  await expect(page.getByLabel(/Left onto Side street/)).not.toBeChecked();
  const {changeset} = await exportChangeset(page, testInfo);
  const [rule] = operationsOn(changeset, 'turn-restrictions.json');
  expect(rule.after.properties).toMatchObject({restriction: 'no_left_turn', from: 30, to: 31});
  // Both roads already end at the junction that the rule names.
  expect(rule.after.properties.viaNodes).toEqual([301]);
  expect(operationsOn(changeset, 'roads.geojson')).toEqual([]);

  await page.getByRole('button', {name: 'Close'}).last().click();
  await tapAt(page, [6, 0]);
  await page.getByRole('button', {name: 'Disconnect'}).last().click();
  await expect.poll(() => statusesOnMap(page)).not.toContain('joined');
  await page.locator('#toast-action').click();
  await expect.poll(() => statusesOnMap(page)).toContain('joined');
});

test('a dragged point joins the road it is put on and takes joined roads along', async ({page}, testInfo) => {
  await centreOn(page, [3, 2]);
  await tapAt(page, [6, 3]);
  await editCorners(page);
  await dragFromTo(page, [6, 5], [2, 0.06]);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  await tapAt(page, [-1, 0]);
  await editCorners(page);
  // A tap on a joined point picks the point, not its junction.
  await tapAt(page, [2, 0]);
  await expect(page.locator('#vertex-disconnect')).toBeEnabled();
  await dragFromTo(page, [2, 0], [2, 1]);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  const {changeset} = await exportChangeset(page, testInfo);
  const [side, main] = operationsOn(changeset, 'roads.geojson');
  expect(main.after.geometry.coordinates.map(stepsOf)).toContainEqual([2, 1]);
  expect(stepsOf(side.after.geometry.coordinates.at(-1))).toEqual([2, 1]);
});

test('one level is shown at a time, and roads under it are neither picked nor joined', async ({page}) => {
  await tapAt(page, [-3, 0]);
  await page.locator('[name="layer"]').evaluate(select => select.closest('details').setAttribute('open', ''));
  await page.locator('[name="layer"]').selectOption('-1');
  await applyEdit(page);
  const picker = page.locator('#level-picker');
  await expect(picker.getByRole('button')).toHaveText(['All', '0', '-1']);
  await picker.getByRole('button', {name: 'Level 0'}).click();
  await expect(picker.getByRole('button', {name: 'Level 0'})).toHaveAttribute('aria-pressed', 'true');
  // Below the ground Main street still shows where it comes up and joins Side street.
  await picker.getByRole('button', {name: 'Level -1'}).click();
  await expect.poll(() => statusesOnMap(page)).toEqual(['deadEnd', 'joined']);
  await picker.getByRole('button', {name: 'All levels'}).click();
  await tapAt(page, [-3, 0]);
  await expect(page.locator('#selection-title')).toHaveText('Main street');
});
