import {test, expect} from '@playwright/test';
import {applyEdit, chooseLayer, dragFromTo, editCorners, exportChangeset, operationsOn, tapAt} from './city-steps.mjs';
import {openFixtureCity, stepsOf} from './fixture-city.mjs';
import {openObjects} from './workspace.mjs';

// One acceptance case for the surface that only version 5 has: a shared municipal edge is one changeset. The phone
// shows only settlement points, so this corner-drag case belongs to the desk.
test('a version 5 municipal corner moves both sides of the border in one changeset', async ({page}, testInfo) => {
  test.skip(testInfo.project.name === 'pages-mobile', 'The phone does not show municipal outlines.');
  await openFixtureCity(page, 5);
  await chooseLayer(page, 'settlements', [0, 0], 18);
  await tapAt(page, [0, 0]);
  await openObjects(page);
  await page.getByRole('button', {name: /^West · Polygon · feature/}).click();
  await expect(page.locator('#selection-title')).toHaveText('West');
  await editCorners(page);
  await dragFromTo(page, [0, 0], [2, 0]);
  await page.locator('#mode-done').click();
  await applyEdit(page);

  const {changeset} = await exportChangeset(page, testInfo);
  const sides = operationsOn(changeset, 'surface.geojson').filter(({reference}) =>
    ['relation/90', 'relation/91'].includes(reference.entityId)
  );
  expect(sides.map(({reference}) => reference.entityId).sort()).toEqual(['relation/90', 'relation/91']);
  for (const {operation, after} of sides) {
    expect(operation).toBe('modify');
    expect(after.geometry.coordinates[0].map(stepsOf)).toContainEqual([2, 0]);
  }
});
