import {test, expect} from '@playwright/test';

// Asserts source inspection against this app's own built artifact. Editing has its own spec.
test.describe('source viewer', () => {
  const modeStatus = (manifest, filename) => {
    const {featureCount} = manifest.layers.find(layer => layer.filename === filename);
    const access = ['context-countries.geojson', 'transport-stops.geojson'].includes(filename)
      ? 'read-only'
      : 'editable';
    return `${filename} · ${featureCount} source features · ${access}`;
  };

  const fetchSource = async (page, filename) => {
    const response = await page.request.get(new URL(`sources/${filename}`, page.url()).href);
    return response.json();
  };

  // No neighbour shares the click target, so the selection can only be this point.
  const isIsolatedPoint = (feature, features) => {
    const sourcePointSeparationDegrees = 0.0004;
    const [longitude, latitude] = feature.geometry.coordinates;
    return features.every(other => {
      const [otherLongitude, otherLatitude] = other.geometry.coordinates;
      const distanceDegrees = Math.hypot(otherLongitude - longitude, otherLatitude - latitude);
      return other === feature || distanceDegrees > sourcePointSeparationDegrees;
    });
  };

  const averageCoordinate = coordinates => {
    const sum = axis => coordinates.reduce((total, coordinate) => total + coordinate[axis], 0);
    return [sum(0) / coordinates.length, sum(1) / coordinates.length];
  };

  async function centerSourceMap(page, coordinate, zoom) {
    await page.evaluate(
      ([center, targetZoom]) => window.editorDebug.map.jumpTo({center, zoom: targetZoom}),
      [coordinate, zoom]
    );
    await expect.poll(() => page.evaluate(() => window.editorDebug.map.isMoving())).toBe(false);
  }

  // Measures after scrolling, because selecting a mode can move the map on the stacked phone layout.
  async function clickMapCenter(page, renderedLayer) {
    await expect
      .poll(() =>
        page.evaluate(layer => window.editorDebug.map.queryRenderedFeatures({layers: [layer]}).length, renderedLayer)
      )
      .toBeGreaterThan(0);
    await page.locator('#map').scrollIntoViewIfNeeded();
    const center = await page.evaluate(() => {
      const bounds = window.editorDebug.map.getCanvas().getBoundingClientRect();
      return {x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2};
    });
    await page.mouse.click(center.x, center.y);
  }

  const expectRenderedSelection = (page, selectionLayer) =>
    expect
      .poll(() =>
        page.evaluate(layer => window.editorDebug.map.queryRenderedFeatures({layers: [layer]}).length, selectionLayer)
      )
      .toBeGreaterThan(0);

  test('real source viewer has one mode per file and selects full source metadata independently', {tag: '@phone'}, async ({page}) => {
    const scriptErrors = [];
    page.on('pageerror', error => scriptErrors.push(error.message));
    await page.goto('./');
    await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
    await expect(page.locator('[data-mode]')).toHaveCount(8);
    await expect(page.locator('[data-source]')).toHaveCount(8);
    const manifest = await fetchSource(page, 'manifest.json');
    for (const layer of manifest.layers) {
      await page.getByRole('button', {name: 'Layers', exact: true}).click();
      await page.locator(`[data-mode="${layer.filename}"]`).click();
      await expect(page.locator('#status')).toHaveText(modeStatus(manifest, layer.filename));
      await expect(page.locator('[data-mode][aria-pressed="true"]')).toHaveCount(1);
    }
    await page.getByRole('button', {name: 'Layers', exact: true}).click();
    await page.locator('[data-mode="places.geojson"]').click();
    await expect(page.locator('#status')).toHaveText(modeStatus(manifest, 'places.geojson'));
    const places = await fetchSource(page, 'places.geojson');
    const place = places.features.find(
      feature =>
        feature.properties.name && feature.properties.visibilityLevel === 4 && isIsolatedPoint(feature, places.features)
    );
    expect(place).toBeTruthy();
    await centerSourceMap(page, place.geometry.coordinates, 15);
    await clickMapCenter(page, 'editor-source-point');
    const published = await page.evaluate(() => {
      const map = window.editorDebug.map;
      const layers = map.getStyle().layers.filter(layer => layer.source === 'places');
      return {
        zoom: map.getZoom(),
        minZoom: layers.find(layer => layer.id === 'place-icons-4-open').minzoom,
        visible: map.queryRenderedFeatures({layers: layers.map(layer => layer.id)}).length
      };
    });
    expect(published).toEqual({zoom: 15, minZoom: 16, visible: 0});
    await expect(page.locator('#selection-title')).toHaveText(place.properties.name);
    await expect(page.locator('#selection-source')).toContainText('places.geojson · feature');
    await expect(page.locator('#identity')).toContainText('Pinned source SHA-256');
    await expect(page.locator('#properties')).toContainText('visibilityLevel');
    await expect(page.locator('#status')).toContainText('selected');
    await expect
      .poll(() =>
        page.evaluate(
          () => window.editorDebug.map.queryRenderedFeatures({layers: ['editor-source-selection-point']}).length
        )
      )
      .toBeGreaterThan(0);
    await expect(page.locator('.inspector')).toBeVisible();
    await page.getByRole('button', {name: 'Layers', exact: true}).click();
    await page.locator('[data-mode="transport-stops.geojson"]').click();
    await expect(page.locator('#status')).toHaveText(modeStatus(manifest, 'transport-stops.geojson'));
    const stops = await fetchSource(page, 'transport-stops.geojson');
    const stop = stops.features.find(feature => isIsolatedPoint(feature, stops.features));
    await centerSourceMap(page, stop.geometry.coordinates, 15);
    await clickMapCenter(page, 'editor-source-point');
    await expect(page.locator('#source-id')).toHaveText(`Source feature ID: ${stop.id}`);
    await page.getByRole('button', {name: 'Layers', exact: true}).click();
    await page.locator('[data-mode="building-labels.geojson"]').click();
    await expect(page.locator('#properties')).toBeEmpty();
    await expect(page.locator('#source-id')).toBeEmpty();
    await expect(page.locator('#selection-source')).toHaveText('Inspecting building-labels.geojson');
    await page.getByRole('button', {name: 'Layers', exact: true}).click();
    await page.locator('[data-mode="buildings.geojson"]').click();
    await expect(page.locator('[data-mode="building-labels.geojson"]')).toHaveAttribute('aria-pressed', 'false');
    const publishedBuildingsFilter = () => page.evaluate(() => window.editorDebug.map.getFilter('buildings') ?? null);
    expect(await publishedBuildingsFilter()).not.toBeNull();
    await page.getByRole('button', {name: 'Layers', exact: true}).click();
    await page.locator('#browse').click();
    expect(await publishedBuildingsFilter()).toBeNull();
    await expect(page.locator('[data-mode][aria-pressed="true"]')).toHaveCount(0);
    await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
    // Browse selects nothing and offers no feature tools. Editing.spec covers what happens with pending changes.
    await clickMapCenter(page, 'buildings');
    await expect(page.locator('#selection-title')).toHaveText('Select an object');
    await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
    await expect(page.locator('#add-feature')).toHaveAttribute('hidden', '');
    await expect(page.locator('#undo')).toBeDisabled();
    await expect(page.locator('#redo')).toBeDisabled();
    await expect(page.locator('#error')).toBeHidden();
    expect(scriptErrors).toEqual([]);
  });

  test('source viewer selects polygons and lines from full source geometry, and toggles satellite', async ({page}) => {
    await page.goto('./');
    await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
    const manifest = await fetchSource(page, 'manifest.json');
    const closeZoom = 18;

    await page.getByRole('button', {name: 'Layers', exact: true}).click();
    await page.locator('[data-mode="buildings.geojson"]').click();
    await expect(page.locator('#status')).toHaveText(modeStatus(manifest, 'buildings.geojson'));
    const buildings = await fetchSource(page, 'buildings.geojson');
    // A four-corner footprint is taken to be convex, so the average of its corners lies inside it.
    const quadrilateral = buildings.features.find(feature => feature.geometry.coordinates[0].length === 5);
    const corners = quadrilateral.geometry.coordinates[0].slice(0, 4);
    await centerSourceMap(page, averageCoordinate(corners), closeZoom);
    await clickMapCenter(page, 'editor-source-fill');
    await expect(page.locator('#selection-title')).toHaveText('Polygon');
    await expect(page.locator('#selection-source')).toContainText('buildings.geojson · feature');
    await expectRenderedSelection(page, 'editor-source-selection-fill');

    await page.getByRole('button', {name: 'Layers', exact: true}).click();
    await page.locator('[data-mode="roads.geojson"]').click();
    await expect(page.locator('#status')).toHaveText(modeStatus(manifest, 'roads.geojson'));
    const roads = await fetchSource(page, 'roads.geojson');
    const straightRoad = roads.features.find(feature => feature.geometry.coordinates.length === 2);
    await centerSourceMap(page, averageCoordinate(straightRoad.geometry.coordinates), closeZoom);
    await clickMapCenter(page, 'editor-source-line');
    await expect(page.locator('#selection-source')).toContainText('roads.geojson · feature');
    await expectRenderedSelection(page, 'editor-source-selection-line');

    const satelliteVisibility = () =>
      page.evaluate(() => window.editorDebug.map.getLayoutProperty('satellite-preview', 'visibility'));
    await page.getByRole('button', {name: 'Tools', exact: true}).click();
    await page.locator('#satellite').click();
    await expect(page.locator('#satellite')).toHaveAttribute('aria-pressed', 'true');
    expect(await satelliteVisibility()).toBe('visible');
    await page.locator('#satellite').click();
    await expect(page.locator('#satellite')).toHaveAttribute('aria-pressed', 'false');
    expect(await satelliteVisibility()).toBe('none');
    await expect(page.locator('#error')).toBeHidden();
  });

  test('source viewer rejects tampered source bytes before enabling modes', async ({page}) => {
    await page.route('**/sources/buildings.geojson', route =>
      route.fulfill({json: {type: 'FeatureCollection', features: []}})
    );
    await page.goto('./');
    await expect(page.locator('#error')).toContainText('Source integrity mismatch: buildings.geojson');
    await expect(page.locator('[data-mode]')).toHaveCount(0);
    await expect(page.locator('#browse')).toBeDisabled();
  });
});

test('workspace keeps the map and layer when its available space changes', {tag: '@phone'}, async ({page}) => {
  await page.setViewportSize({width: 360, height: 740});
  await page.goto('./');
  await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
  const attribution = page.locator('.maplibregl-ctrl-attrib');
  await expect(attribution).not.toHaveAttribute('open', '');
  await attribution.locator('summary').click();
  await expect(attribution).toHaveAttribute('open', '');
  const map = page.locator('#map');
  await expect(map).toHaveCSS('height', '740px');
  const changes = page.getByRole('button', {name: 'Changes', exact: true});
  expect(await changes.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(740);

  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await page.locator('[data-mode="places.geojson"]').click();
  await expect(page.locator('#current-layer')).toHaveText('POIs');
  await expect(page.locator('#status')).toContainText('source features');
  const initialView = await page.evaluate(() => ({
    center: window.editorDebug.map.getCenter().toArray(),
    zoom: window.editorDebug.map.getZoom()
  }));
  await page.setViewportSize({width: 900, height: 500});
  await expect(page.locator('#current-layer')).toHaveText('POIs');
  expect(await page.evaluate(() => ({
    center: window.editorDebug.map.getCenter().toArray(),
    zoom: window.editorDebug.map.getZoom()
  }))).toEqual(initialView);
  await expect(page.locator('#map')).toHaveCSS('height', '500px');
  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await expect(page.locator('#layers-panel').getByRole('link', {name: 'OpenStreetMap contributors'})).toBeVisible();
});
