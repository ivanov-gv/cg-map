import {test, expect} from '@playwright/test';
import {
  addUnderCross,
  applyEdit,
  chooseLayer,
  exportChangeset,
  operationsOn,
  startDrawing,
  tapAt
} from './city-steps.mjs';
import {openFixtureCity} from './fixture-city.mjs';

const isPhone = testInfo => testInfo.project.name === 'pages-mobile';

// At the desk a click on the first corner closes the outline; a phone adds it under the fixed cross.
async function placePoint(page, position, phone) {
  if (phone) await addUnderCross(page, position);
  else await tapAt(page, position);
}

test.beforeEach(async ({page}) => {
  await openFixtureCity(page, 4);
});

test('a drawn bridge gets the map-core deck and a drawn rail gets the rail preview', async ({page}, testInfo) => {
  const phone = isPhone(testInfo);
  await chooseLayer(page, 'roads', [0, 0]);
  await startDrawing(page, 'Draw bridge');
  const corners = [[-1.5, -1.5], [1.5, -1.5], [1.5, 1.5]];
  for (const corner of corners) await placePoint(page, corner, phone);
  if (phone) await page.locator('#mode-done').click();
  else await placePoint(page, corners[0], phone);
  await expect(page.locator('#mode-bar')).toBeHidden();
  await applyEdit(page);

  const drawnOf = layerId =>
    page.evaluate(
      layer => window.editorDebug.map.queryRenderedFeatures({layers: [layer]}).filter(feature => feature.properties.sourceFile),
      layerId
    );
  await expect.poll(() => drawnOf('edit-preview-bridge-decks')).not.toHaveLength(0);
  await expect.poll(() => drawnOf('edit-preview-bridge-deck-edges')).not.toHaveLength(0);

  await chooseLayer(page, 'railways', [0, 3]);
  await startDrawing(page, 'Draw rail');
  await placePoint(page, [-2, 5], phone);
  await placePoint(page, [2, 5], phone);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  await expect.poll(() => drawnOf('edit-preview-rail-casing')).not.toHaveLength(0);

  const {changeset} = await exportChangeset(page, testInfo);
  const [bridge] = operationsOn(changeset, 'bridges.geojson');
  expect(bridge.operation).toBe('add');
  expect(bridge.after.properties.kind).toBe('bridge');
  expect(bridge.after.properties.method).toBe('traced');
  const [rail] = operationsOn(changeset, 'railways.geojson');
  expect(rail.operation).toBe('add');
  expect(rail.after.properties.kind).toBe('rail');
  expect(rail.after.geometry.type).toBe('LineString');
});
