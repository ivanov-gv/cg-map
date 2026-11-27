import {test, expect} from '@playwright/test';
import {
  applyEdit,
  chooseLayer,
  exportChangeset,
  operationsOn,
  startDrawing,
  tapAt,
  waitForRepaint
} from './city-steps.mjs';
import {at, openFixtureCity} from './fixture-city.mjs';

// Version 4 derives the two tones from the ridge. This is the one browser case for that step: all other parity comes
// from the shared fixed cases, which run without a browser.
test.beforeEach(async ({page}) => {
  await openFixtureCity(page, 4);
});

const isPhone = testInfo => testInfo.project.name === 'pages-mobile';

test('a drawn ridge draws two slope faces and records only the ridge', async ({page}, testInfo) => {
  test.skip(isPhone(testInfo), 'Ridges are desk work.');
  await chooseLayer(page, 'relief', [8, -2], 18);
  await startDrawing(page, 'Draw ridge');
  await tapAt(page, [2, -2]);
  await tapAt(page, [14, -2]);
  await page.locator('#mode-done').click();
  await applyEdit(page);
  await waitForRepaint(page);

  // The fixture also has a hill ridge, so only the park faces below it belong to the ridge just drawn.
  const parkFaceLatitude = at(0, -1)[1];
  const preview = await page.evaluate(async latitude => {
    const {map} = window.editorDebug;
    const layers = ['edit-preview-shaded-slopes', 'edit-preview-sunlit-slopes'].filter(id => map.getLayer(id));
    const features = (await map.getSource('edit-preview-slopes.geojson')?.getData())?.features ?? [];
    const parkFaces = features.filter(({geometry}) => {
      const latitudes = geometry.coordinates.flat().map(([, value]) => value);
      return Math.min(...latitudes) < latitude;
    });
    return {
      layers,
      parkAspects: parkFaces.map(feature => feature.properties.aspect).sort(),
      renderedCount: map.queryRenderedFeatures({layers}).length
    };
  }, parkFaceLatitude);
  expect(preview.layers.sort()).toEqual(['edit-preview-shaded-slopes', 'edit-preview-sunlit-slopes']);
  expect(preview.parkAspects).toEqual(['shaded', 'sunlit']);
  expect(preview.renderedCount).toBeGreaterThanOrEqual(2);

  const {changeset} = await exportChangeset(page, testInfo);
  const [ridge] = operationsOn(changeset, 'ridges.geojson');
  expect(ridge.operation).toBe('add');
  expect(operationsOn(changeset, 'slopes.geojson')).toHaveLength(0);
});
