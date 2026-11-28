import {test, expect} from '@playwright/test';
import {applyEdit, chooseLayer, dragFromTo, editCorners, exportChangeset, operationsOn, tapAt} from './city-steps.mjs';
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

  // The whole run of the edge, not just the dragged corner, is the same on both sides.
  const edgeThroughMovedCorner = after => {
    const ring = after.geometry.coordinates[0].map(stepsOf);
    const index = ring.findIndex(([east, north]) => east === 2 && north === 0);
    expect(index).toBeGreaterThan(0);
    return [ring[index - 1], ring[index], ring[index + 1]];
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
              geometry: feature.geometry
            }))
          ])
      );
    });
  for (const layerId of ['green', 'water']) {
    await chooseLayer(page, layerId, [0, 0], 18);
    const preview = await surfacePreview();
    expect(preview.land.map(({kind}) => kind)).toEqual(expect.arrayContaining(['park', 'municipality', 'context']));
    expect(preview.water.map(({kind}) => kind)).toEqual(expect.arrayContaining(['lake', 'sea']));
    expect(preview['park-names'].map(({kind, geometry}) => [kind, geometry.type])).toEqual([
      ['protected-area', 'LineString']
    ]);
    const westInPreview = preview.land.find(({entityId}) => entityId === 'relation/90');
    expect(westInPreview).toBeDefined();
    // MapLibre may wind a GeoJSON ring the other way; the edited vertices, not their order, are what must be drawn.
    const vertices = geometry => geometry.coordinates[0].map(stepsOf).map(point => point.join(',')).sort();
    expect(vertices(westInPreview.geometry)).toEqual(vertices(westAfter.geometry));
  }
});
