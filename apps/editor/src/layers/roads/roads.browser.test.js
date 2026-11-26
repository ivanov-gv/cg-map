// Roads bugs that need a browser but not the whole app. Each test mounts only roads and junctions through the shared
// harness in tests/e2e/support, so a broken component is found without the panels and startup of app.js.
import {test, expect} from '@playwright/test';
import {
  applyEdit,
  centreOn,
  dragFromTo,
  editCorners,
  operationsOn,
  tapAt
} from '../../../tests/e2e/city-steps.mjs';
import {stepsOf} from '../../../tests/e2e/fixture-city.mjs';
import {openRoadsHarness} from '../../../tests/e2e/support/roads-harness.mjs';

test.beforeEach(async ({page}, testInfo) => {
  test.skip(testInfo.project.name === 'pages-mobile', 'The road graph and joining are desk work.');
  await openRoadsHarness(page, testInfo.project.use.baseURL);
});

const statusesOnMap = page =>
  page.evaluate(async () => {
    const {features} = await window.editorDebug.map.getSource('editor-joints').getData();
    return features.map(({properties}) => properties.status).sort();
  });

const shapesIn = (page, source) =>
  page.evaluate(async name => {
    const {features} = await window.editorDebug.map.getSource(name).getData();
    return features.map(({geometry}) => geometry.coordinates);
  }, source);

const changesetOf = page => page.evaluate(() => window.roadsHarness.exportChangeset());

// Bug: changing access, kind and furniture edits must stay one step with the road, and an open edit must not be lost when
// the junction at its end opens.
test('a road gets its access, and its ends open the junctions they are at', async ({page}) => {
  await tapAt(page, [-3, 0]);
  await expect(page.locator('.end-row')).toHaveText([/A.*Dead end/s, /B.*Joins Side street/s]);
  await page.locator('[name="motor_vehicle"]').selectOption('no');
  await page.getByText('More', {exact: true}).click();
  await page.locator('[name="smoothness"]').selectOption('very_bad');
  await page.locator('[name="kind"]').selectOption('pedestrian');
  await page.getByRole('button', {name: 'Open the junction at B'}).click();
  await expect(page.locator('#edit-problem')).toContainText('Apply or Cancel');
  await applyEdit(page);
  await tapAt(page, [-3, 0]);
  await page.getByRole('button', {name: 'Open the junction at B'}).click();
  await expect(page.locator('#selection-kind')).toHaveText('Junction');
  await page.getByLabel('What stands here').selectOption('traffic_signals');
  await applyEdit(page);
  const changeset = await changesetOf(page);
  const [road] = operationsOn(changeset, 'roads.geojson');
  const [light] = operationsOn(changeset, 'road-nodes.geojson');
  expect(road.after.properties).toMatchObject({kind: 'pedestrian', motor_vehicle: 'no', smoothness: 'very_bad'});
  expect(light.after.properties).toEqual({kind: 'traffic_signals'});
  expect(stepsOf(light.after.geometry.coordinates)).toEqual([6, 0]);
});

// Bug: joint status and turn rules must agree with the road graph, and Undo must take back a whole shared step.
test('joints are shown, and a junction is opened, given a turn rule, disconnected and joined again', async ({page}) => {
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
  const changeset = await changesetOf(page);
  const [rule] = operationsOn(changeset, 'turn-restrictions.json');
  expect(rule.after.properties).toMatchObject({restriction: 'no_left_turn', from: 30, to: 31});
  expect(rule.after.properties.viaNodes).toEqual([301]);
  expect(operationsOn(changeset, 'roads.geojson')).toEqual([]);

  await page.getByRole('button', {name: 'Close'}).last().click();
  await tapAt(page, [6, 0]);
  await page.getByRole('button', {name: 'Disconnect'}).last().click();
  await expect.poll(() => statusesOnMap(page)).not.toContain('joined');
  await page.locator('#toast-action').click();
  await expect.poll(() => statusesOnMap(page)).toContain('joined');
});

// Bug: a point dragged onto another road must snap to it, and the roads already joined there must move with it.
test('a dragged point joins the road it is put on and takes joined roads along', async ({page}) => {
  await centreOn(page, [3, 2]);
  await tapAt(page, [6, 3]);
  await editCorners(page);
  await dragFromTo(page, [6, 5], [2, 0.06]);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  await tapAt(page, [-1, 0]);
  await editCorners(page);
  await tapAt(page, [2, 0]);
  await expect(page.locator('#vertex-disconnect')).toBeEnabled();
  await dragFromTo(page, [2, 0], [2, 1]);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  const changeset = await changesetOf(page);
  const [side, main] = operationsOn(changeset, 'roads.geojson');
  expect(main.after.geometry.coordinates.map(stepsOf)).toContainEqual([2, 1]);
  expect(stepsOf(side.after.geometry.coordinates.at(-1))).toEqual([2, 1]);
});

// Bug: moving a junction must show where all its roads will be, and Cancel must leave no ghost or pending change.
test('a moved junction shows its roads where they will be, and Cancel leaves nothing behind', async ({page}) => {
  await centreOn(page, [5, 2]);
  await tapAt(page, [6, 0]);
  await page.locator('#tool-move').click();
  await dragFromTo(page, [5, 1], [5, 2]);
  const following = () => shapesIn(page, 'editor-following');
  await expect
    .poll(async () => (await following()).map(line => line.map(stepsOf).filter(([, north]) => north === 1).length))
    .toEqual([1, 1]);
  await expect.poll(async () => (await shapesIn(page, 'editor-ghost')).length).toBe(3);
  await page.locator('#mode-done').click();
  await page.locator('#cancel-edit').click();
  await expect.poll(following).toEqual([]);
  await expect.poll(() => shapesIn(page, 'editor-ghost')).toEqual([]);
  await expect(page.locator('#change-count')).toBeHidden();
});

// Bug: a line that loses its points must be refused in the mode bar, and the map must still pick the object afterwards.
test('a line that loses its points is refused in the bar, and nothing breaks', async ({page}) => {
  await centreOn(page, [6, 3], 18.5);
  await tapAt(page, [6, 3]);
  await editCorners(page);
  for (const point of [[6, 5], [6, 0]]) {
    await tapAt(page, point);
    await page.locator('#vertex-remove').click();
    await expect(page.locator('#mode-notice')).toBeVisible();
  }
  await page.locator('#mode-done').click();
  await page.locator('#cancel-edit').click();
  await tapAt(page, [6, 3]);
  await expect(page.locator('#selection-title')).toHaveText('Side street');
});

// Bug: one shown level must filter both picking and joining, while a road coming up from below stays drawn and joined.
test('one level is shown at a time, and roads under it are neither picked nor joined', async ({page}) => {
  await tapAt(page, [-3, 0]);
  await page.locator('[name="layer"]').evaluate(select => select.closest('details').setAttribute('open', ''));
  await page.locator('[name="layer"]').selectOption('-1');
  await applyEdit(page);
  const picker = page.locator('#level-picker');
  await expect(picker.getByRole('button')).toHaveText(['All', '0', '-1']);
  await picker.getByRole('button', {name: 'Level 0'}).click();
  await expect(picker.getByRole('button', {name: 'Level 0'})).toHaveAttribute('aria-pressed', 'true');
  await picker.getByRole('button', {name: 'Level -1'}).click();
  await expect.poll(() => statusesOnMap(page)).toEqual(['deadEnd', 'joined']);
  await picker.getByRole('button', {name: 'All levels'}).click();
  await tapAt(page, [-3, 0]);
  await expect(page.locator('#selection-title')).toHaveText('Main street');
});
