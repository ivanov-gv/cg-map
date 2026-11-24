import {test, expect} from '@playwright/test';
import {applyEdit, chooseLayer, dragFromTo, editCorners, exportChangeset, operationsOn, startDrawing, tapAt} from './city-steps.mjs';
import {at, openFixtureCity, stepsOf} from './fixture-city.mjs';

test.beforeEach(async ({page}) => {
  await openFixtureCity(page);
});

const isPhone = testInfo => testInfo.project.name === 'pages-mobile';
const includesStep = ({after}, expected) =>
  after.geometry.coordinates[0].some(point => String(stepsOf(point)) === String(expected));

test('a contour stops at its neighbour, a summit must be above them, and a ridge recolours both sides', async ({
  page
}, testInfo) => {
  test.skip(isPhone(testInfo), 'Contours and ridges are desk work.');
  await chooseLayer(page, 'relief', [15, 4], 18);
  // The 60 m line cannot be dragged past the 40 m line around it.
  await tapAt(page, [15, 2]);
  await expect(page.locator('#selection-title')).toHaveText('60 m');
  await editCorners(page);
  await dragFromTo(page, [12, 2], [8.5, 1]);
  await page.locator('#mode-done').click();
  await applyEdit(page);

  await startDrawing(page, 'Add summit');
  await tapAt(page, [13, 7]);
  await page.locator('[name="name"]').fill('Small hill');
  await page.locator('[name="ele"]').fill('55');
  await page.locator('#apply-edit').click();
  await expect(page.locator('#edit-problem')).toContainText('higher than 60 m');
  await page.locator('[name="ele"]').fill('71');
  await applyEdit(page);

  await tapAt(page, [17, 5]);
  await expect(page.locator('#selection-title')).toHaveText('Town hill');
  await editCorners(page);
  await dragFromTo(page, [15, 5], [15, 6]);
  await page.locator('#mode-done').click();
  await applyEdit(page);

  const {changeset} = await exportChangeset(page, testInfo);
  const [contour] = operationsOn(changeset, 'contours.geojson');
  const [corner] = contour.after.geometry.coordinates;
  // It went as far as the line around it and no further.
  expect(corner[0]).toBeGreaterThan(at(10, 0)[0]);
  expect(corner[0]).toBeLessThan(at(10.2, 0)[0]);
  expect(contour.after.geometry.coordinates.at(-1)).toEqual(corner);
  const [summit] = operationsOn(changeset, 'summits.geojson');
  expect(summit.after.properties).toEqual({kind: 'summit', natural: 'peak', name: 'Small hill', ele: 71});
  const slopes = operationsOn(changeset, 'slopes.geojson');
  expect(slopes).toHaveLength(2);
  for (const slope of slopes) expect(includesStep(slope, [15, 6])).toBe(true);
});

test('a town is renamed and added, and on the phone only towns can be picked', {tag: '@phone'}, async ({page}, testInfo) => {
  await chooseLayer(page, 'settlements', [0, 6], 18);
  await expect(page.locator('#status')).toContainText(isPhone(testInfo) ? '1 objects' : '5 objects');
  await tapAt(page, [-3, 8]);
  await expect(page.locator('#selection-title')).toHaveText('Town');
  await page.locator('[name="rank"]').selectOption('city');
  await applyEdit(page);
  await startDrawing(page, 'Add town');
  await tapAt(page, [4, 6]);
  await page.locator('[name="name"]').fill('New village');
  await page.locator('[name="rank"]').selectOption('village');
  await applyEdit(page);
  const {changeset} = await exportChangeset(page, testInfo);
  const added = changeset.operations.find(({operation}) => operation === 'add');
  expect(added.after.properties).toEqual({
    kind: 'settlement',
    source: 'Local correction',
    name: 'New village',
    rank: 'village',
    place: 'village',
    municipality: 'ME-02'
  });
});

test('a municipality border moves both sides at once', async ({page}, testInfo) => {
  test.skip(isPhone(testInfo), 'Borders need a big screen.');
  await chooseLayer(page, 'settlements', [0, 0], 18);
  await tapAt(page, [0, 3]);
  await expect(page.locator('#selection-title')).toHaveText('West | East');
  await editCorners(page);
  await dragFromTo(page, [0, 0], [2, 0]);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  await expect(page.locator('#change-count')).toHaveText('3');
  const {changeset} = await exportChangeset(page, testInfo);
  const municipalities = operationsOn(changeset, 'municipalities.geojson');
  expect(municipalities.map(({reference}) => reference.entityId)).toEqual(['relation/90', 'relation/91']);
  for (const municipality of municipalities) expect(includesStep(municipality, [2, 0])).toBe(true);
});
