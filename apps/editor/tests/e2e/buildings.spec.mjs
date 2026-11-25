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
import {at, openFixtureCity, stepsOf} from './fixture-city.mjs';

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

const overlapCount = page =>
  page.evaluate(async () => (await window.editorDebug.map.getSource('editor-overlaps').getData()).features.length);
// Point handles show the drawn corners before a line has two points and appears in the drawing source.
const drawnCorners = async page => {
  const coordinates = await page.evaluate(async () => {
    const {features} = await window.editorDebug.map.getSource('editor-handles').getData();
    return features.map(({geometry}) => geometry.coordinates);
  });
  return coordinates.map(stepsOf);
};
const selectedCorners = async page => {
  const coordinates = await page.evaluate(async () => {
    const {features} = await window.editorDebug.map.getSource('editor-source-selection').getData();
    return features[0]?.geometry.coordinates[0] ?? [];
  });
  return coordinates.map(stepsOf);
};

test('a building is drawn and moved against its neighbour, and an overlap is said and shown', async ({page}, testInfo) => {
  await startDrawing(page, 'Draw building');
  await expect(page.getByRole('button', {name: 'Magnet'})).toHaveAttribute('aria-pressed', 'true');
  // Two taps close on screen are one double click, so only one corner stays even where they snap differently.
  await tapAt(page, [-0.95, 1.05], {clickCount: 2});
  await expect.poll(() => drawnCorners(page)).toEqual([[-1, 1]]);
  for (const corner of [[0.5, 1], [0.5, 2], [-0.96, 2]]) await tapAt(page, corner);
  await page.locator('#mode-done').click();
  await expect(page.locator('#edit-facts')).not.toContainText('Overlaps');
  await applyEdit(page);

  await tapAt(page, [0, 1.5]);
  await editCorners(page);
  // The source ring closes at the corner it starts from.
  await expect.poll(() => selectedCorners(page)).toEqual([
    [-1, 1],
    [-1, 2],
    [0.5, 2],
    [0.5, 1],
    [-1, 1]
  ]);
  // At zoom 17 a 12 px reach is about 5 m, so only the target corner is close enough, not the rest of the step.
  await centreOn(page, [-1, 2], 17);
  await dragFromTo(page, [-1, 2], [-0.95, 3.05]);
  await expect.poll(() => selectedCorners(page)).toEqual([
    [-1, 1],
    [-1, 3],
    [0.5, 2],
    [0.5, 1],
    [-1, 1]
  ]);
  await page.locator('#mode-done').click();
  await page.locator('#cancel-edit').click();
  await centreOn(page, [0, 0]);

  await tapAt(page, [0, 1.5]);
  await editCorners(page);
  await dragFromTo(page, [-1, 2], [-2, 2]);
  await expect(page.locator('#mode-notice')).toHaveText('Overlaps 1 area: Main street 14');
  await expect.poll(() => overlapCount(page)).toBe(1);
  await page.locator('#mode-done').click();
  await expect(page.locator('#edit-facts')).toContainText('Overlaps 1 area: Main street 14');
  await page.locator('#cancel-edit').click();
  await expect.poll(() => overlapCount(page)).toBe(0);

  // With the magnet off a corner stays where it is put, and the switch is remembered after a reload.
  await tapAt(page, [0, 1.5]);
  await editCorners(page);
  await page.getByRole('button', {name: 'Magnet'}).click();
  await expect(page.getByRole('button', {name: 'Magnet'})).toHaveAttribute('aria-pressed', 'false');
  await dragFromTo(page, [0.5, 2], [0.95, 2.95]);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  await page.reload();
  await expect(page.locator('#status')).toContainText('Browse');
  await chooseLayer(page, 'buildings');
  await tapAt(page, [2, 2]);
  await page.locator('#tool-move').click();
  await expect(page.getByRole('button', {name: 'Magnet'})).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#mode-done').click();
  await page.locator('#cancel-edit').click();

  // With the magnet back on, a whole building goes to its neighbour's corner and keeps its shape.
  await tapAt(page, [2, 2]);
  await page.locator('#tool-move').click();
  await page.getByRole('button', {name: 'Magnet'}).click();
  await expect(page.getByRole('button', {name: 'Magnet'})).toHaveAttribute('aria-pressed', 'true');
  await dragFromTo(page, [2, 2], [-0.1, 2]);
  await page.locator('#mode-done').click();
  await applyEdit(page);

  const {changeset} = await exportChangeset(page, testInfo);
  const buildings = operationsOn(changeset, 'buildings.geojson');
  const building = buildings.find(({after}) => after.properties.entityId === undefined);
  const corners = building.after.geometry.coordinates[0].map(stepsOf);
  expect(corners[0]).toEqual([-1, 1]);
  expect(corners[3]).toEqual([-1, 2]);
  // Close to the corner of the other house, and not on it.
  expect(building.after.geometry.coordinates[0][2]).not.toEqual(at(1, 3));

  const moved = buildings.find(({reference}) => reference?.entityId === 'way/2');
  expect(moved.after.geometry.coordinates[0].map(stepsOf)).toEqual([
    [-1, 1],
    [1, 1],
    [1, 3],
    [-1, 3],
    [-1, 1]
  ]);
});
