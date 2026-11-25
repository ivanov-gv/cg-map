import {test, expect} from '@playwright/test';
import {applyEdit, chooseLayer, dragFromTo, exportChangeset, operationsOn, startDrawing, tapAt} from './city-steps.mjs';
import {openFixtureCity, stepsOf} from './fixture-city.mjs';

const isPhone = testInfo => testInfo.project.name === 'pages-mobile';

test.beforeEach(async ({page}) => {
  await openFixtureCity(page);
});

test('a stop is added on the side that is clicked, moved along the road and kept while a line needs it', async ({
  page
}, testInfo) => {
  test.skip(isPhone(testInfo), 'The phone takes the same path, with the fixed cross.');
  await chooseLayer(page, 'stops');
  await startDrawing(page, 'Add stop');
  await tapAt(page, [3, -0.6]);
  await page.locator('[name="name"]').fill('New stop');
  await page.locator('#tool-move').click();
  await dragFromTo(page, [3, 0], [2, -0.5]);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  await tapAt(page, [0, 0.2]);
  await page.locator('#delete-feature').click();
  await expect(page.locator('#edit-problem')).toContainText('Line 6');
  await page.locator('#cancel-edit').click();

  const {changeset} = await exportChangeset(page, testInfo);
  const [stop] = operationsOn(changeset, 'transport-stops.geojson');
  const {localId} = stop.reference;
  expect(stop.after.id).toBe(localId);
  expect(stop.after.properties).toEqual({stopId: localId, name: 'New stop', side: 'right'});
  const [east, north] = stepsOf(stop.after.geometry.coordinates);
  expect(east).toBe(2);
  expect(north).toBeLessThan(0);
});

test('a line is picked from the list, gets a stop and a turn, and a new one is made and copied', async ({page}, testInfo) => {
  test.skip(isPhone(testInfo), 'Lines are view only on the phone.');
  await chooseLayer(page, 'routes');
  await page.getByRole('button', {name: /Line 6/}).click();
  await expect(page.locator('#selection-title')).toHaveText('Line 6');
  const pathCount = () =>
    page.evaluate(() => window.editorDebug.map.queryRenderedFeatures({layers: ['editor-path']}).length);
  await expect.poll(pathCount).toBeGreaterThan(0);
  await page.getByRole('button', {name: 'Add stop'}).click();
  await tapAt(page, [5, 0.2]);
  await expect(page.locator('#mode-title')).toContainText('· 3');
  await page.locator('#mode-cancel').click();
  await page.getByRole('button', {name: 'Add turn'}).click();
  await tapAt(page, [2, 0]);
  await expect(page.locator('#inspector-extras')).toContainText('Stops in order · 3 + 1 turn');
  await page.getByRole('button', {name: 'Move East stop up'}).click();
  await applyEdit(page);

  await startNewLine(page);
  await page.locator('[name="number"]').fill('23');
  await page.getByRole('button', {name: 'Add stop'}).click();
  await tapAt(page, [-5, 0.2]);
  await tapAt(page, [5, 0.2]);
  await page.locator('#mode-cancel').click();
  await page.getByRole('button', {name: 'Add the other direction'}).click();
  await expect(page.locator('.route-stop span').first()).toHaveText('1 · East stop');
  await applyEdit(page);

  const {changeset} = await exportChangeset(page, testInfo);
  const routes = operationsOn(changeset, 'transit-routes.json');
  const changed = routes.find(({operation}) => operation === 'modify').after.properties.directions[0].stops;
  expect(changed.map(stop => (typeof stop === 'string' ? stop : 'turn'))).toEqual(['1', '2', '3', 'turn']);
  const added = routes.find(({operation}) => operation === 'add').after.properties;
  expect(added.directions).toEqual([
    {headsign: 'East stop', stops: ['1', '3']},
    {headsign: 'West stop', stops: ['3', '1']}
  ]);
  const lines = operationsOn(changeset, 'transport-stops.geojson').map(({reference, after}) => [
    reference.entityId,
    after.properties.lines
  ]);
  expect(Object.fromEntries(lines)).toEqual({'epodgorica:1': ['23', '6'], 'epodgorica:3': ['23', '6']});
});

async function startNewLine(page) {
  const tools = page.getByRole('button', {name: 'Tools', exact: true});
  if ((await tools.getAttribute('aria-expanded')) !== 'true') await tools.click();
  await page.getByRole('button', {name: 'New line', exact: true}).click();
}

test('on the phone a line can be read and not changed', {tag: '@phone'}, async ({page}, testInfo) => {
  test.skip(!isPhone(testInfo), 'The desk edits lines.');
  await chooseLayer(page, 'routes');
  await page.getByRole('button', {name: /Line 6/}).click();
  await expect(page.locator('.route-stop span').first()).toHaveText('1 · West stop');
  await expect(page.locator('#apply-edit')).toBeHidden();
  await expect(page.locator('#property-form input')).toHaveCount(0);
});
