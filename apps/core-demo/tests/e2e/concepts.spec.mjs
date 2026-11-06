import {test, expect} from '@playwright/test';

// Exercises each shared capability through the public map-core entry only.
test.describe('core concepts', () => {
  test('core concept controls exercise camera, POIs, projection, overlays, selection, satellite and teardown', async ({
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
    await page.locator('#satellite').click();
    await expect(page.locator('#satellite')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => window.coreDemoDebug.map === window.originalConceptMap)).toBe(true);
    await page.locator('#recreate').click();
    await expect(page.locator('#recreate')).toBeEnabled();
    expect(await page.evaluate(() => window.coreDemoDebug.map === window.originalConceptMap)).toBe(false);
    await expect(page.locator('.maplibregl-canvas')).toHaveCount(1);
    await expect(page.locator('#geometry')).toHaveText('Point');
    await expect(page.locator('#satellite')).toHaveAttribute('aria-pressed', 'false');
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
