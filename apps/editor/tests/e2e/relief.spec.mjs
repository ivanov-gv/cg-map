import {test, expect} from '@playwright/test';
import {
  applyEdit,
  chooseLayer,
  dragFromTo,
  editCorners,
  exportChangeset,
  operationsOn,
  startDrawing,
  tapAt,
  waitForRepaint
} from './city-steps.mjs';
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

test("an edited canyon edge is drawn at once with map-core's own canyon layers", async ({page}, testInfo) => {
  test.skip(isPhone(testInfo), 'Canyon edges are desk work.');
  await chooseLayer(page, 'relief', [-8, 9], 18);
  await tapAt(page, [-8, 9]);
  await expect(page.locator('#selection-kind')).toHaveText('Canyon edge');
  await editCorners(page);
  await dragFromTo(page, [-7, 9], [-6, 9]);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  await waitForRepaint(page);

  const preview = await page.evaluate(() => {
    const {map} = window.editorDebug;
    const styleLayers = map.getStyle().layers;
    const published = styleLayers.filter(layer => layer.id.startsWith('canyon-'));
    const copies = styleLayers.filter(layer => layer.id.startsWith('edit-preview-canyon-'));
    return {
      publishedIds: published.map(({id}) => id),
      previewIds: copies.map(({id}) => id),
      copy: copies.find(({id}) => id === 'edit-preview-canyon-rims'),
      published: published.find(({id}) => id === 'canyon-rims'),
      rendered: map.queryRenderedFeatures({layers: copies.map(({id}) => id)}).length,
      originalFilter: map.getFilter('canyon-rims')
    };
  });
  expect(preview.publishedIds).toContain('canyon-rims');
  expect(preview.publishedIds).toContain('canyon-wall-0');
  expect(preview.previewIds.sort()).toEqual(preview.publishedIds.map(id => `edit-preview-${id}`).sort());
  expect(preview.copy.paint).toEqual(preview.published.paint);
  expect(preview.copy.layout).toEqual(preview.published.layout);
  expect(preview.rendered).toBeGreaterThan(0);
  expect(preview.originalFilter).toEqual(['==', ['literal', 1], 0]);

  const {features} = await page.evaluate(() => window.editorDebug.map.getSource('editor-source').getData());
  const rim = features.find(feature => feature.properties.sourceFile === 'canyon-rims.geojson');
  expect(rim).toBeDefined();
  const drawnSteps = rim.geometry.coordinates.map(stepsOf);
  expect(drawnSteps).toContainEqual([-6, 9]);
  expect(drawnSteps).not.toContainEqual([-7, 9]);

  const {changeset} = await exportChangeset(page, testInfo);
  const [edit] = operationsOn(changeset, 'canyon-rims.geojson');
  expect(edit.operation).toBe('modify');
});

test('a town is renamed and added, and on the phone only towns can be picked', {tag: '@phone'}, async ({page}, testInfo) => {
  await chooseLayer(page, 'settlements', [0, 6], 18);
  await expect(page.locator('#status')).toContainText(isPhone(testInfo) ? '1 objects' : '6 objects');
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

test('the area of a settlement is shown, opened from it, reshaped and drawn where there is none', async ({page}, testInfo) => {
  test.skip(isPhone(testInfo), 'Areas need a big screen.');
  await chooseLayer(page, 'settlements', [0, 7], 18);
  await tapAt(page, [-3, 8]);
  await page.getByRole('button', {name: 'Open its area'}).click();
  await expect(page.locator('#selection-kind')).toHaveText('Settlement area');
  await expect(page.getByRole('button', {name: 'Open Town'})).toBeVisible();
  await editCorners(page);
  await dragFromTo(page, [-1, 10], [0, 10]);
  await page.locator('#mode-done').click();
  await applyEdit(page);

  await startDrawing(page, 'Add town');
  await tapAt(page, [4, 8]);
  await page.locator('[name="name"]').fill('New quarter');
  await page.locator('[name="place"]').selectOption('neighbourhood');
  await page.locator('[name="rank"]').selectOption('village');
  await applyEdit(page);
  await tapAt(page, [4, 8]);
  await expect(page.locator('#selection-kind')).toHaveText('Settlement · neighbourhood');
  await page.getByRole('button', {name: 'Draw its area'}).click();
  for (const corner of [[3, 7], [5, 7], [5, 9]]) await tapAt(page, corner);
  await page.locator('#mode-done').click();
  await applyEdit(page);

  const {changeset} = await exportChangeset(page, testInfo);
  const areas = operationsOn(changeset, 'settlement-areas.geojson');
  const town = operationsOn(changeset, 'settlements.geojson').find(({operation}) => operation === 'add');
  expect(town.after.properties).toMatchObject({place: 'neighbourhood', rank: 'village'});
  expect(includesStep(areas.find(({operation}) => operation === 'modify'), [0, 10])).toBe(true);
  expect(areas.find(({operation}) => operation === 'add').after.properties).toEqual({
    kind: 'settlement-area',
    name: 'New quarter',
    settlementEntityId: town.reference.localId
  });
});

test('the end of a ridge slides along the outline of its hill', async ({page}, testInfo) => {
  test.skip(isPhone(testInfo), 'Ridges are desk work.');
  await chooseLayer(page, 'relief', [15, 4], 18);
  await tapAt(page, [17, 5]);
  await editCorners(page);
  // Away from the outline it stays on it.
  await dragFromTo(page, [10, 5], [8.5, 7]);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  const {changeset} = await exportChangeset(page, testInfo);
  const [ridge] = operationsOn(changeset, 'ridges.geojson');
  expect(stepsOf(ridge.after.geometry.coordinates[0])).toEqual([10, 7]);
  const slopes = operationsOn(changeset, 'slopes.geojson');
  expect(slopes).toHaveLength(2);
  const isSunlit = ({after}) => after.properties.aspect === 'sunlit';
  expect(includesStep(slopes.find(isSunlit), [10, 5]) || includesStep(slopes.find(isSunlit), [10, 0])).toBe(true);
  expect(includesStep(slopes.find(slope => !isSunlit(slope)), [10, 5])).toBe(false);
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
