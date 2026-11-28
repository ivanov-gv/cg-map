import {test, expect} from '@playwright/test';
import {applyEdit, chooseLayer, dragFromTo, editCorners, exportChangeset, operationsOn, startDrawing, tapAt} from './city-steps.mjs';
import {openFixtureCity, stepsOf} from './fixture-city.mjs';
import {openObjects} from './workspace.mjs';

// One acceptance case for the surface that only version 5 has: a shared municipal edge is one changeset, the whole file
// keeps being drawn after another surface layer opens, and both exports hold the complete shared edge. The phone shows
// only settlement points, so this corner-drag case belongs to the desk.
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
  for (const {operation} of sides) expect(operation).toBe('modify');

  // The whole run of the edge, not just the dragged corner, is the same on both sides. A splice can rotate a ring, so
  // find the corner rather than assuming where the ring starts; the closing point is not another corner to inspect.
  const edgeThroughMovedCorner = after => {
    const ring = after.geometry.coordinates[0].map(stepsOf);
    const corners = ring.slice(0, -1);
    const index = corners.findIndex(([east, north]) => east === 2 && north === 0);
    expect(index).toBeGreaterThanOrEqual(0);
    return [
      corners[(index - 1 + corners.length) % corners.length],
      corners[index],
      corners[(index + 1) % corners.length]
    ];
  };
  const westAfter = sides.find(({reference}) => reference.entityId === 'relation/90').after;
  const eastAfter = sides.find(({reference}) => reference.entityId === 'relation/91').after;
  const westEdge = edgeThroughMovedCorner(westAfter);
  expect(westEdge).toEqual([[0, -600], [2, 0], [0, 600]]);
  expect(edgeThroughMovedCorner(eastAfter)).toEqual([...westEdge].reverse());

  // Each public layer that draws the surface gets the whole working file, so switching layers cannot hide the edit.
  const surfacePreview = () =>
    page.evaluate(() => {
      const prefix = 'edit-preview-surface.geojson-';
      const sources = window.editorDebug.map.getStyle().sources;
      return Object.fromEntries(
        Object.entries(sources)
          .filter(([id]) => id.startsWith(prefix))
          .map(([id, source]) => [
            id.slice(prefix.length),
            (source.data?.features ?? []).map(feature => ({
              entityId: feature.properties.entityId,
              kind: feature.properties.kind,
              selectionKey: feature.properties.selectionKey,
              sourceFile: feature.properties.sourceFile,
              geometry: feature.geometry
            }))
          ])
      );
    });
  for (const layerId of ['green', 'water']) {
    await chooseLayer(page, layerId, [0, 0], 18);
    const preview = await surfacePreview();
    expect(preview.land.map(({kind}) => kind)).toEqual(expect.arrayContaining(['park', 'context']));
    expect(preview.water.map(({kind}) => kind)).toEqual(expect.arrayContaining(['municipality', 'lake', 'sea']));
    expect(preview.rivers.map(({kind}) => kind)).toEqual(expect.arrayContaining(['river']));
    expect(preview['park-names'].map(({kind, geometry}) => [kind, geometry.type])).toEqual([
      ['protected-area', 'LineString']
    ]);
    const westInPreview = preview.water.find(({entityId}) => entityId === 'relation/90');
    expect(westInPreview).toBeDefined();
    expect(westInPreview.sourceFile).toBe('surface.geojson');
    expect(typeof westInPreview.selectionKey).toBe('string');
    // MapLibre may wind a GeoJSON ring the other way; the edited vertices, not their order, are what must be drawn.
    const vertices = geometry => geometry.coordinates[0].map(stepsOf).map(point => point.join(',')).sort();
    expect(vertices(westInPreview.geometry)).toEqual(vertices(westAfter.geometry));
  }
});

test('a version 5 POI added inside a building is linked and previewed through place layers', async ({page}, testInfo) => {
  test.skip(testInfo.project.name === 'pages-mobile', 'The desktop drawing flow is used for this one acceptance case.');
  await openFixtureCity(page, 5);

  await expect.poll(() =>
    page.evaluate(() => {
      const source = window.editorDebug.map.getSource('places');
      const features = source?.serialize?.().data?.features ?? source?._data?.features ?? [];
      return features.some(feature => feature.properties.label === 'Seed cafe');
    })
  ).toBe(true);

  await chooseLayer(page, 'places', [-2, 2], 16);
  await startDrawing(page, 'Add place');
  await tapAt(page, [-2, 2]);

  await page.locator('label:has-text("Name (required)") input').fill('Corner cafe');
  await page.locator('label:has-text("Kind (required)") select').selectOption('cafe');
  await page.locator('label:has-text("Shown from (override)") select').selectOption('1');
  await page.locator('label:has-text("Building") button', {hasText: 'Choose'}).click();
  await page.locator('dialog.river-dialog button', {hasText: /Main street 14/}).click();
  await applyEdit(page);

  await expect.poll(() =>
    page.evaluate(() => {
      const bandOf = label => {
        const layerIds = window.editorDebug.map
          .getStyle()
          .layers.map(layer => layer.id)
          .filter(id => id.startsWith('place-icons-'));
        const features = window.editorDebug.map.queryRenderedFeatures({layers: layerIds});
        const layer = layerIds.find(id => features.some(feature => feature.layer.id === id && feature.properties.label === label));
        return layer?.match(/^place-icons-(.+)$/)?.[1] ?? null;
      };
      return bandOf('Corner cafe');
    })
  ).toBe('1-open');

  const {changeset} = await exportChangeset(page, testInfo);
  const placeOps = operationsOn(changeset, 'places.geojson');
  expect(placeOps).toHaveLength(1);
  expect(placeOps[0].operation).toBe('add');
  expect(placeOps[0].after.properties.buildingEntityId).toBe('way/1');
  expect(placeOps[0].after.properties.kind).toBe('cafe');
  expect(placeOps[0].after.properties.name).toBe('Corner cafe');
  expect(placeOps[0].after.properties.visibilityOverride).toBe(1);
  expect(placeOps[0].after.properties.id).toBeUndefined();
  expect(placeOps[0].after.properties.category).toBeUndefined();
});
