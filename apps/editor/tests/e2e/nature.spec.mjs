import {test, expect} from '@playwright/test';
import {applyEdit, chooseLayer, dragFromTo, editCorners, exportChangeset, operationsOn, startDrawing, tapAt} from './city-steps.mjs';
import {openFixtureCity, stepsOf} from './fixture-city.mjs';

test.beforeEach(async ({page}, testInfo) => {
  test.skip(testInfo.project.name === 'pages-mobile', 'The phone takes the same path through these shapes.');
  await openFixtureCity(page);
});

test('a park gets a hole and loses it again, and a new area is drawn', async ({page}, testInfo) => {
  await chooseLayer(page, 'green', [3, -3]);
  await tapAt(page, [4, -3]);
  await expect(page.locator('#selection-title')).toHaveText('Town park');
  const cutHole = async () => {
    await page.getByRole('button', {name: 'Cut a hole'}).click();
    for (const corner of [[3, -4], [4, -4], [4, -3.5]]) await tapAt(page, corner);
    await tapAt(page, [3, -4]);
  };
  await cutHole();
  await expect(page.locator('#edit-facts')).toContainText('Holes 1');
  await expect(page.locator('#edit-facts')).toContainText('−');
  await page.getByRole('button', {name: 'Remove hole 1'}).click();
  await expect(page.locator('#edit-facts')).toContainText('Holes 0');
  await cutHole();
  await applyEdit(page);

  await startDrawing(page, 'Draw area');
  for (const corner of [[-2, -4], [0, -4], [0, -2]]) await tapAt(page, corner);
  await page.locator('#mode-done').click();
  await page.locator('[name="kind"]').selectOption('meadow');
  await applyEdit(page);

  const {changeset} = await exportChangeset(page, testInfo);
  const operations = operationsOn(changeset, 'land.geojson');
  const park = operations.find(({operation}) => operation === 'modify');
  expect(park.after.geometry.coordinates).toHaveLength(2);
  expect(operations.find(({operation}) => operation === 'add').after.properties).toEqual({kind: 'meadow'});
});

test('a stream keeps its join with the lake and is reversed, and the sea follows a moved coastline', async ({
  page
}, testInfo) => {
  await chooseLayer(page, 'water', [-8, 5]);
  // The stream ends on the lake and begins at a spring.
  const joints = () =>
    page.evaluate(async () => {
      const {features} = await window.editorDebug.map.getSource('editor-joints').getData();
      return features.map(({properties}) => properties.status).sort();
    });
  await expect.poll(joints).toEqual(['deadEnd', 'joined']);
  // The upper shore of the lake moves down; the stream that ended on it still does.
  await tapAt(page, [-7, 3.5]);
  await editCorners(page);
  await tapAt(page, [-6, 5]);
  await dragFromTo(page, [-6, 5], [-6, 3.5]);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  await expect(page.locator('#change-count')).toHaveText('2');
  // The stream now runs to the nearest point of the new shore.
  await tapAt(page, [-8.53, 6.5]);
  await expect(page.locator('#inspector-extras')).toContainText('Flows into Town lake');
  await page.getByRole('button', {name: 'Reverse flow'}).click();
  await expect(page.locator('#inspector-extras')).toContainText('Flows into nothing yet');
  await applyEdit(page);

  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await page.locator('#browse').click();
  await chooseLayer(page, 'water', [-600, 0]);
  await tapAt(page, [-600, 1]);
  await expect(page.locator('#selection-kind')).toHaveText('Coastline');
  await editCorners(page);
  await dragFromTo(page, [-600, 0], [-597, 0]);
  await page.locator('#mode-done').click();
  await applyEdit(page);

  const {changeset} = await exportChangeset(page, testInfo);
  const stream = operationsOn(changeset, 'water.geojson').find(({reference}) => reference.entityId === 'way/61');
  expect(stepsOf(stream.after.geometry.coordinates[1])).toEqual([-9, 8]);
  const coast = operationsOn(changeset, 'water.geojson').find(({reference}) => reference.entityId === 'way/62');
  const [, movedPoint] = coast.after.geometry.coordinates;
  expect(stepsOf(movedPoint)[0]).toBeGreaterThan(-599);
  const isFollowing = ({after}) => JSON.stringify(after.geometry.coordinates).includes(JSON.stringify(movedPoint));
  for (const [filename, entityId] of [
    ['water.geojson', 'derived:ocean'],
    ['land.geojson', 'relation/1'],
    ['border-edges.geojson', 'derived:edge-2'],
    ['municipalities.geojson', 'relation/90']
  ]) {
    const operation = operationsOn(changeset, filename).find(({reference}) => reference.entityId === entityId);
    expect(isFollowing(operation), filename).toBe(true);
  }
});
