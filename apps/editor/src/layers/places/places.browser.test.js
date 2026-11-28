// Places bugs that need a browser but not the whole app. Each test mounts only the places component through the shared
// harness in tests/e2e/support, so a broken place is found without the panels and startup of app.js.
import {test, expect} from '@playwright/test';
import {applyEdit, dragFromTo, operationsOn, startDrawing, tapAt} from '../../../tests/e2e/city-steps.mjs';
import {at, fixtureBundle, stepsOf} from '../../../tests/e2e/fixture-city.mjs';
import {buildingAt} from './layer-places.js';
import {buildingId} from '../shared/object-names.js';
import {openPlacesHarness} from '../../../tests/e2e/support/places-harness.mjs';

const fixture = fixtureBundle();
const featuresOf = filename => JSON.parse(fixture.files.get(filename)).features;
const fixturePlace = featuresOf('places.geojson')[0];
const buildingEntries = featuresOf('buildings.geojson').map((feature, index) => ({
  key: String(index),
  filename: 'buildings.geojson',
  feature
}));

const editedName = 'Edited by the component test';
const openingHours = 'Mo-Fr 08:00-22:00; Sa-Su,PH 10:00-18:00';

test.beforeEach(async ({page}, testInfo) => {
  test.skip(testInfo.project.name === 'pages-mobile', 'The place shape and drag work is desk work.');
  await openPlacesHarness(page, testInfo.project.use.baseURL);
});

const changesetOf = page => page.evaluate(() => window.placesHarness.exportChangeset());

// A place that was moved belongs to the smallest building under its new point, or stands alone.
function expectedPropertiesAfterMove(feature, coordinate) {
  const properties = {...feature.properties};
  delete properties.buildingEntityId;
  delete properties.standalone;
  const building = buildingAt(coordinate, {entriesOf: () => buildingEntries});
  if (building) properties.buildingEntityId = buildingId(building);
  else properties.standalone = true;
  return properties;
}

const screenPointOf = (page, coordinate) =>
  page.evaluate(coordinate => {
    const {map} = window.editorDebug;
    const {x, y} = map.project(coordinate);
    const bounds = map.getCanvas().getBoundingClientRect();
    return {x: bounds.left + x, y: bounds.top + y};
  }, coordinate);

const coordinateAtOffset = (page, coordinate, xPixels, yPixels) =>
  page.evaluate(
    ({coordinate, xPixels, yPixels}) => {
      const {map} = window.editorDebug;
      const {x, y} = map.project(coordinate);
      return map.unproject([x + xPixels, y + yPixels]).toArray();
    },
    {coordinate, xPixels, yPixels}
  );

async function dragByPixels(page, coordinate, xPixels, yPixels) {
  const from = await screenPointOf(page, coordinate);
  const to = await screenPointOf(page, await coordinateAtOffset(page, coordinate, xPixels, yPixels));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, {steps: 4});
  await page.mouse.up();
}

function expectCoordinateNear(actual, expected) {
  const toleranceDegrees = 0.00002;
  expect(Math.abs(actual[0] - expected[0])).toBeLessThan(toleranceDegrees);
  expect(Math.abs(actual[1] - expected[1])).toBeLessThan(toleranceDegrees);
}

async function setOpeningHours(page) {
  await page.getByRole('button', {name: 'Edit', exact: true}).click();
  await page.getByRole('button', {name: 'Weekdays + weekend'}).click();
  await expect(page.locator('#hours-stored')).toHaveText('Mo-Fr 08:00-20:00; Sa-Su 10:00-18:00');
  await page.locator('#hours-dialog').getByLabel('Closes at').first().fill('22:00');
  await page.locator('#hours-dialog').getByLabel('Closes at').first().blur();
  await page.locator('#hours-dialog').getByLabel('Holidays').last().check();
  await page.locator('#hours-done').click();
  await expect(page.locator('[name="opening_hours"]')).toHaveValue(openingHours);
}

// Bug: the name, visibility and hours of a source place must survive the changes the editor exports.
test('a place keeps its details and hours through the changeset', async ({page}) => {
  await tapAt(page, [-2.5, 2.5]);
  await expect(page.locator('#inspector-extras')).toContainText('Inside Main street 14');
  await page.locator('[name="name"]').fill(editedName);
  await page.locator('[name="visibilityLevel"]').selectOption('2');
  await setOpeningHours(page);
  await applyEdit(page);

  const changeset = await changesetOf(page);
  const [operation] = operationsOn(changeset, 'places.geojson');
  expect(operation.operation).toBe('modify');
  expect(operation.reference).toEqual({entityId: 'node/20'});
  expect(operation.before).toEqual(fixturePlace);
  expect(operation.after.properties).toEqual({...fixturePlace.properties, name: editedName, visibilityLevel: 2, opening_hours: openingHours});
  expect(operation.after.geometry).toEqual(fixturePlace.geometry);
});

// Bug: a drawn place needs every required field, remembers the building it is put on, and keeps a local identity when it
// has no source ID yet.
test('a new place needs its fields, gets hours, and belongs to the building it is moved onto', async ({page}) => {
  await tapAt(page, [-2.5, 2.5]);
  await expect(page.locator('.inspector')).toBeVisible();
  await startDrawing(page, 'Add place');
  await expect(page.locator('.inspector')).toBeHidden();
  await tapAt(page, [0, 2]);
  await expect(page.locator('#inspector-extras')).toContainText('Stands on its own');
  await page.locator('[name="name"]').fill('New bakery');
  await page.locator('[data-list-for="kind"]').selectOption({label: 'Other…'});
  await page.locator('[name="kind"]').fill('bakery');
  await page.locator('#apply-edit').click();
  await expect(page.locator('#edit-problem')).toContainText('category is required');
  await page.locator('[name="category"]').selectOption('food');
  await page.locator('#apply-edit').click();
  await expect(page.locator('#edit-problem')).toContainText('visibilityLevel is required');
  await page.locator('[name="visibilityLevel"]').selectOption('4');
  await setOpeningHours(page);

  await page.locator('#tool-move').click();
  await dragFromTo(page, [0, 2], [2, 2]);
  await expect(page.locator('#mode-hint')).toContainText('Inside a building');
  const targetCount = () =>
    page.evaluate(() => window.editorDebug.map.queryRenderedFeatures({layers: ['editor-target']}).length);
  await expect.poll(targetCount).toBeGreaterThan(0);
  await page.locator('#mode-done').click();
  await applyEdit(page);

  const changeset = await changesetOf(page);
  const [operation] = operationsOn(changeset, 'places.geojson');
  expect(operation.operation).toBe('add');
  expect(operation.reference.localId).toMatch(/^local:/);
  expect(operation.before).toBeNull();
  expect(operation.after.properties.id).toBe(operation.reference.localId);
  expect(operation.after.properties.source).toBe('Local correction');
  expect(operation.after.properties.osm_id).toBeUndefined();
  expect(operation.after.properties.visibilityLevel).toBe(4);
  expect(operation.after.properties).toMatchObject({
    name: 'New bakery',
    category: 'food',
    kind: 'bakery',
    buildingEntityId: 'way/2',
    opening_hours: openingHours
  });
  expect(operation.after.properties.standalone).toBeUndefined();
  expect(stepsOf(operation.after.geometry.coordinates)).toEqual([2, 2]);
});

// Bug: a source place is one undoable change when it is deleted, and a drag starts where it is pressed, adds both moves
// and leaves nothing at the old point.
test('a source place can be deleted and undone, and moves by relative drags with no ghost', async ({page}) => {
  await tapAt(page, [-2.5, 2.5]);
  await page.locator('#delete-feature').click();
  await expect(page.locator('#delete-dialog')).toBeVisible();
  await expect(page.locator('#delete-title')).toHaveText('Delete Corner cafe?');
  await page.locator('#delete-confirm').click();
  await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#toast')).toContainText('Deleted · Corner cafe');
  await expect(page.locator('#change-count')).toHaveText('1');
  await page.locator('#toast-action').click();
  await expect(page.locator('#change-count')).toBeHidden();
  expect((await changesetOf(page)).operations).toEqual([]);

  await tapAt(page, [-2.5, 2.5]);
  const origin = at(-2.5, 2.5);
  const expected = await coordinateAtOffset(page, origin, 90, 0);
  const pressPoint = await coordinateAtOffset(page, origin, -60, 50);
  await page.locator('#tool-move').click();
  await dragByPixels(page, pressPoint, 70, 0);
  await dragByPixels(page, pressPoint, 20, 0);
  await expect(page.locator('#change-count')).toBeHidden();
  await page.locator('#mode-done').click();
  await applyEdit(page);
  await expect(page.locator('#change-count')).toHaveText('1');

  const renderedAtOldPosition = await page.evaluate(
    origin => window.editorDebug.map.queryRenderedFeatures(window.editorDebug.map.project(origin), {layers: ['editor-source-point']}).length,
    origin
  );
  expect(renderedAtOldPosition).toBe(0);

  const [moved] = operationsOn(await changesetOf(page), 'places.geojson');
  expect(moved.reference).toEqual({entityId: 'node/20'});
  expectCoordinateNear(moved.after.geometry.coordinates, expected);
  expect(moved.after.properties).toEqual(expectedPropertiesAfterMove(moved.before, moved.after.geometry.coordinates));
});
