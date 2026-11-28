import {test, expect} from '@playwright/test';

// The two version-5 samples are resolved by the data policy and installed away from the default view.
const visibilitySamples = [
  {buttonId: 'kind-band', center: [19.56, 42.11], level: 2, markerId: 'demo/kind-band', zoom: 14},
  {buttonId: 'override-band', center: [19.58, 42.11], level: 4, markerId: 'demo/override-band', zoom: 16}
];

// Checks that a sample renders at its resolved zoom threshold and not one zoom level below it.
async function checkVisibilitySampleBand(page, sample) {
  const layerId = `place-icons-${sample.level}-open`;
  const isSampleRendered = () =>
    page.evaluate(
      ({layerId, markerId}) =>
        window.coreDemoDebug.map
          .queryRenderedFeatures({layers: [layerId]})
          .some(feature => feature.properties.markerKey === markerId),
      {layerId, markerId: sample.markerId}
    );
  await page.locator(`#${sample.buttonId}`).click();
  await expect.poll(() => page.evaluate(() => window.coreDemoDebug.map.getZoom())).toBe(sample.zoom);
  const isCentered = await page.evaluate(center => {
    const mapCenter = window.coreDemoDebug.map.getCenter();
    return Math.abs(mapCenter.lng - center[0]) < 0.001 && Math.abs(mapCenter.lat - center[1]) < 0.001;
  }, sample.center);
  expect(isCentered).toBe(true);
  await expect.poll(isSampleRendered).toBe(true);
  await page.evaluate(zoom => window.coreDemoDebug.map.jumpTo({zoom}), sample.zoom - 1);
  await expect.poll(isSampleRendered).toBe(false);
}

// Exercises each shared capability through the public map-core entry only.
test.describe('core concepts', () => {
  test('core concept controls exercise camera, POIs, projection, overlays, states, selection, satellite and teardown', async ({
    page
  }) => {
    const scriptErrors = [];
    page.on('pageerror', error => scriptErrors.push(error.message));
    await page.goto('./');
    await expect(page.locator('#status')).toHaveText('Ready · core imports only');
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
    await page.evaluate(() => {
      window.originalConceptMap = window.coreDemoDebug.map;
    });
    await page.locator('#overview').click();
    await expect(page.locator('#camera')).toHaveText('Zoom 12.0');
    await page.locator('#street').click();
    await expect(page.locator('#camera')).toHaveText('Zoom 16.0');
    await expect.poll(() => page.locator('#pois').textContent()).toMatch(/[1-9]\d* visible markers/);
    const originalCoordinate = await page.locator('#coordinate').textContent();
    await page.locator('#shift').click();
    await expect(page.locator('#coordinate')).not.toHaveText(originalCoordinate);
    const coordinate = (await page.locator('#coordinate').textContent()).split(', ').map(Number);
    await page.locator('#map').scrollIntoViewIfNeeded();
    const point = await page.evaluate(coordinates => {
      const map = window.coreDemoDebug.map;
      const projected = map.project(coordinates);
      const bounds = map.getCanvas().getBoundingClientRect();
      return {x: projected.x + bounds.left, y: projected.y + bounds.top};
    }, coordinate);
    await page.mouse.click(point.x, point.y);
    await expect(page.locator('#selection')).toHaveText('Concept overlay selected');
    await expect
      .poll(() =>
        page.evaluate(
          () => window.coreDemoDebug.map.queryRenderedFeatures({layers: ['concept-selection-point']}).length
        )
      )
      .toBeGreaterThan(0);
    await page.locator('#clear-selection').click();
    await expect(page.locator('#selection')).toHaveText('Nothing selected');
    await page.locator('#replace').click();
    await expect(page.locator('#geometry')).toHaveText('Polygon');
    await page.locator('#overlay-toggle').click();
    await expect(page.locator('#overlay-toggle')).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(() =>
        page.evaluate(() => window.coreDemoDebug.map.queryRenderedFeatures({layers: ['concept-fill']}).length)
      )
      .toBe(0);
    await page.locator('#overlay-toggle').click();
    await expect
      .poll(() =>
        page.evaluate(() => window.coreDemoDebug.map.queryRenderedFeatures({layers: ['concept-fill']}).length)
      )
      .toBeGreaterThan(0);
    await page.locator('#overlay-editable').click();
    await expect(page.locator('#overlay-editable')).toHaveAttribute('aria-pressed', 'true');
    expect(
      await page.evaluate(() => window.coreDemoDebug.map.getPaintProperty('concept-line', 'line-width'))
    ).toBe(1.5);
    await page.locator('#satellite').click();
    await expect(page.locator('#satellite')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.coreDemoDebug.map === window.originalConceptMap)).toBe(true);
    await page.locator('#recreate').click();
    await expect(page.locator('#recreate')).toBeEnabled();
    expect(await page.evaluate(() => window.coreDemoDebug.map === window.originalConceptMap)).toBe(false);
    await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
    await expect(page.locator('#geometry')).toHaveText('Point');
    await expect(page.locator('#satellite')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#overlay-editable')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#zoom-bands')).toContainText('Kind rule · museum: level 2 · zoom 14');
    await expect(page.locator('#zoom-bands')).toContainText('visibilityOverride · 4: level 4 · zoom 16');
    for (const sample of visibilitySamples) {
      await checkVisibilitySampleBand(page, sample);
    }
    await expect(page.locator('#error')).toBeHidden();
    expect(scriptErrors).toEqual([]);
  });

  test('core concept app can retry after a failed map startup without a reload', async ({page}) => {
    await page.goto('./');
    await expect(page.locator('#status')).toHaveText('Ready · core imports only');
    await page.evaluate(() => {
      const workingMap = window.maplibregl.Map;
      window.maplibregl.Map = function () {
        window.maplibregl.Map = workingMap;
        throw new Error('Simulated startup failure');
      };
    });
    await page.locator('#recreate').click();
    await expect(page.locator('#error')).toHaveText('Simulated startup failure');
    await expect(page.locator('#recreate')).toBeEnabled();
    await expect(page.locator('#reset')).toBeDisabled();
    await page.locator('#recreate').click();
    await expect(page.locator('#status')).toHaveText('Ready · core imports only');
    await expect(page.locator('#error')).toBeHidden();
    await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
  });
});
