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
    const published = await page.evaluate(placeId => {
      const map = window.editorDebug.map;
      const layers = map.getStyle().layers.filter(layer => layer.source === 'places');
      return {
        zoom: map.getZoom(),
        minZoom: layers.find(layer => layer.id === 'place-icons-4-open').minzoom,
        visible: map.queryRenderedFeatures({layers: layers.map(layer => layer.id)})
          .filter(hit => JSON.parse(hit.properties.activeIds).includes(placeId)).length
      };
    }, place.properties.id);
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
    await clickMapCenter(page, 'edit-preview-buildings');
    await expect(page.locator('#selection-title')).toHaveText('Polygon');
    await expect(page.locator('#selection-source')).toContainText('buildings.geojson · feature');
    await expectRenderedSelection(page, 'editor-source-selection-line');

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
  await page.evaluate(() => {
    document.querySelector('#offline-notice').hidden = false;
    document.querySelector('#draft-notice').hidden = false;
    document.querySelector('#status').classList.add('attention');
  });
  const layerBounds = await page.locator('#current-layer').boundingBox();
  const offlineBounds = await page.locator('#offline-notice').boundingBox();
  const draftBounds = await page.locator('#draft-notice').boundingBox();
  const statusBounds = await page.locator('#status').boundingBox();
  expect(offlineBounds.y).toBeGreaterThanOrEqual(layerBounds.y + layerBounds.height);
  expect(draftBounds.y).toBeGreaterThanOrEqual(offlineBounds.y + offlineBounds.height);
  expect(statusBounds.y).toBeGreaterThanOrEqual(draftBounds.y + draftBounds.height);
  await page.evaluate(() => {
    document.querySelector('#offline-notice').hidden = true;
    document.querySelector('#draft-notice').hidden = true;
    document.querySelector('#status').classList.remove('attention');
  });
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


async function chooseMode(page, filename) {
  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await page.locator(`[data-mode="${filename}"]`).click();
  await expect(page.locator('#status')).toContainText('source features');
}

async function setView(page, center, zoom) {
  await page.evaluate(({center, zoom}) => window.editorDebug.map.jumpTo({center, zoom}), {center, zoom});
  await expect.poll(() => page.evaluate(() => window.editorDebug.map.loaded())).toBe(true);
}

async function toggleGuides(page) {
  await page.getByRole('button', {name: 'Tools', exact: true}).click();
  await page.locator('#edit-guides').click();
  await page.getByRole('button', {name: 'Tools', exact: true}).click();
  await expect(page.locator('#status')).toContainText('source features');
}

async function clickCoordinate(page, coordinate) {
  const point = await page.evaluate(coordinate => {
    const {map} = window.editorDebug;
    const bounds = map.getCanvas().getBoundingClientRect();
    const point = map.project(coordinate);
    return {x: bounds.left + point.x, y: bounds.top + point.y};
  }, coordinate);
  await page.mouse.click(point.x, point.y);
}

// Select an isolated low-priority POI so a hidden-object tap cannot accidentally hit a neighbouring visible marker.
async function isolatedPlace(page) {
  const response = await page.request.get(new URL('sources/places.geojson', page.url()).href);
  const {features} = await response.json();
  const feature = features.find(candidate => candidate.properties.visibilityLevel === 4 && features.every(other => {
    const distance = Math.hypot(...candidate.geometry.coordinates.map((value, axis) => value - other.geometry.coordinates[axis]));
    return candidate === other || distance > 0.001;
  }));
  expect(feature).toBeTruthy();
  return feature;
}

async function renderedPlaceIds(page) {
  return page.evaluate(() => {
    const {map} = window.editorDebug;
    const layers = map.getStyle().layers.filter(layer => layer.source === 'places').map(layer => layer.id);
    return map.queryRenderedFeatures({layers}).flatMap(hit => JSON.parse(hit.properties.activeIds));
  });
}

test('hollow POI guides preserve public icons and labels, and hidden objects never take taps', {tag: '@phone'}, async ({page}, testInfo) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
  const feature = await isolatedPlace(page);
  const coordinate = feature.geometry.coordinates;
  await chooseMode(page, 'places.geojson');
  await setView(page, coordinate, 16);
  await expect.poll(() => renderedPlaceIds(page)).toContain(feature.properties.id);
  const normalStyle = await page.evaluate(() => {
    const {map} = window.editorDebug;
    return {
      icon: map.getLayoutProperty('place-icons-4-open', 'icon-image'),
      label: map.getLayoutProperty('place-names-4-open', 'text-field'),
      fill: map.getPaintProperty('editor-source-point', 'circle-opacity'),
      radius: map.getPaintProperty('editor-source-point', 'circle-radius'),
      selectionBehindNames: map.getStyle().layers.findIndex(layer => layer.id === 'editor-source-selection-point')
        < map.getStyle().layers.findIndex(layer => layer.id === 'place-names-4-open')
    };
  });
  expect(normalStyle).toEqual({icon: ['get', 'icon'], label: ['get', 'label'], fill: 0, radius: 13, selectionBehindNames: true});
  await page.screenshot({path: testInfo.outputPath('hollow-guides.png')});
  await clickCoordinate(page, coordinate);
  await expect(page.locator('#selection-title')).toHaveText(feature.properties.name);
  await page.locator('#close-inspector').click();
  await toggleGuides(page);
  await expect(page.locator('#edit-guides')).toHaveAttribute('aria-pressed', 'false');
  // Selection is an independent outer ring, and the collapsed inspector remains available.
  expect(await page.evaluate(() => window.editorDebug.map.getLayoutProperty('editor-source-selection-point', 'visibility')))
    .not.toBe('none');
  await expect(page.locator('#open-inspector')).toBeVisible();
  await setView(page, coordinate, 15);
  expect(await renderedPlaceIds(page)).not.toContain(feature.properties.id);
  await clickCoordinate(page, coordinate);
  await expect(page.locator('#selection-title')).toHaveText('Select an object');
  await toggleGuides(page);
  await clickCoordinate(page, coordinate);
  await expect(page.locator('#selection-title')).toHaveText(feature.properties.name);
  await page.locator('#cancel-edit').click();
  await setView(page, coordinate, 14);
  expect(await page.evaluate(() => window.editorDebug.map.queryRenderedFeatures({layers: ['editor-source-point']}).length))
    .toBe(0);
  await clickCoordinate(page, coordinate);
  await expect(page.locator('#selection-title')).toHaveText('Select an object');
  await expect(page.locator('#error')).toBeHidden();
});

test('applied changes use amber guides, refresh normal rendering, and undo restores green', {tag: '@phone'}, async ({page}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
  const feature = await isolatedPlace(page);
  await chooseMode(page, 'places.geojson');
  await setView(page, feature.geometry.coordinates, 17);
  await clickCoordinate(page, feature.geometry.coordinates);
  await page.locator('[name="name"]').fill('Amber guide test');
  await page.locator('[name="name:en"]').fill('Amber guide test');
  await page.locator('#apply-edit').click();
  await expect(page.locator('#status')).toContainText('source features');
  const changedState = () => page.evaluate(id => {
    const {map} = window.editorDebug;
    return {
      guide: map.querySourceFeatures('editor-source').find(hit => hit.properties.id === id)?.properties.isChanged,
      label: map.querySourceFeatures('places').find(hit => JSON.parse(hit.properties.activeIds).includes(id))?.properties.label
    };
  }, feature.properties.id);
  await expect.poll(changedState).toEqual({guide: true, label: 'Amber guide test'});
  expect(await page.evaluate(() => window.editorDebug.map.getPaintProperty('editor-source-point', 'circle-stroke-color')))
    .toEqual(['case', ['get', 'isChanged'], '#a66a12', '#32634d']);
  await page.getByRole('button', {name: 'Tools', exact: true}).click();
  await page.locator('#undo').click();
  await expect.poll(changedState).toEqual({guide: false, label: feature.properties['name:en'] ?? feature.properties.name});
});

test('every file keeps normal cartography and guide-off hits require rendered geometry', async ({page}, testInfo) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
  for (const filename of ['buildings.geojson', 'roads.geojson', 'land.geojson', 'water.geojson', 'building-labels.geojson']) {
    const normal = await page.evaluate(filename => {
      const {map} = window.editorDebug;
      const ids = {
        'buildings.geojson': 'buildings', 'roads.geojson': 'major-roads', 'land.geojson': 'land',
        'water.geojson': 'water', 'building-labels.geojson': 'building-numbers'
      };
      return map.getStyle().layers.find(layer => layer.id === ids[filename]);
    }, filename);
    await chooseMode(page, filename);
    const style = await page.evaluate(id => {
      const {map} = window.editorDebug;
      return map.getStyle().layers.find(layer => layer.id === `edit-preview-${id}` || layer.id === id);
    }, normal.id);
    expect(style.paint).toEqual(normal.paint);
    expect(style.layout).toEqual(normal.layout);
  }
  await setView(page, [19.2594, 42.4411], 18);
  await page.screenshot({path: testInfo.outputPath('building-label-guides.png')});
  await toggleGuides(page);
  await setView(page, [19.2594, 42.4411], 12);
  await clickCoordinate(page, [19.2594, 42.4411]);
  await expect(page.locator('#selection-title')).toHaveText('Select an object');
  await chooseMode(page, 'transport-stops.geojson');
  const response = await page.request.get(new URL('sources/transport-stops.geojson', page.url()).href);
  const {features} = await response.json();
  const stop = features[0];
  await setView(page, stop.geometry.coordinates, 17);
  await clickCoordinate(page, stop.geometry.coordinates);
  await expect(page.locator('#selection-title')).toHaveText(stop.properties.name);
  await expect(page.locator('#lock-reason')).toContainText('transit import');
  await expect(page.locator('#error')).toBeHidden();
});

test('a resumed shared-location move installs its public zoom bands with guides off', {tag: '@phone'}, async ({page}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
  const [sourceResponse, manifestResponse] = await Promise.all([
    page.request.get(new URL('sources/places.geojson', page.url()).href),
    page.request.get(new URL('sources/manifest.json', page.url()).href)
  ]);
  const {features} = await sourceResponse.json();
  const manifest = await manifestResponse.json();
  const index = features.findIndex(feature => feature.properties.visibilityLevel === 3);
  const destination = features.find(feature => feature.properties.visibilityLevel === 4);
  const before = features[index];
  const after = {...before, geometry: destination.geometry};
  const base = manifest.layers.find(layer => layer.filename === 'places.geojson').sha256;
  const draft = {
    version: 1,
    files: {'places.geojson': {
      base,
      changes: [[String(index), {operation: 'modify', reference: {featureIndex: index}, before, after}]],
      history: {undo: [], redo: []}
    }}
  };
  await page.evaluate(draft => localStorage.setItem('kompas-editor-draft-v1', JSON.stringify(draft)), draft);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
  await chooseMode(page, 'places.geojson');
  await toggleGuides(page);
  await setView(page, destination.geometry.coordinates, 15);
  await expect.poll(() => renderedPlaceIds(page)).toContain(before.properties.id);
  expect(await renderedPlaceIds(page)).not.toContain(destination.properties.id);
  const band = await page.evaluate(() => window.editorDebug.map.getLayer('place-icons-3-4'));
  expect(band).toBeTruthy();
  await clickCoordinate(page, destination.geometry.coordinates);
  await expect(page.locator('#selection-title')).toHaveText(before.properties.name);
  await page.locator('#cancel-edit').click();
  await setView(page, destination.geometry.coordinates, 16);
  await expect.poll(() => renderedPlaceIds(page)).toContain(destination.properties.id);
  await expect.poll(() => renderedPlaceIds(page)).toContain(before.properties.id);
  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await page.locator('#browse').click();
  await expect.poll(() => page.evaluate(() => Boolean(window.editorDebug.map.getLayer('place-icons-3-4')))).toBe(false);
  await expect(page.locator('#error')).toBeHidden();
});

test('a corrupt saved visibility level reports an error while the active mode remains consistent', async ({page}) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
  const [sourceResponse, manifestResponse] = await Promise.all([
    page.request.get(new URL('sources/places.geojson', page.url()).href),
    page.request.get(new URL('sources/manifest.json', page.url()).href)
  ]);
  const {features} = await sourceResponse.json();
  const manifest = await manifestResponse.json();
  const before = features[0];
  const after = {...before, properties: {...before.properties, visibilityLevel: 99}};
  const base = manifest.layers.find(layer => layer.filename === 'places.geojson').sha256;
  const draft = {version: 1, files: {'places.geojson': {
    base, changes: [['0', {operation: 'modify', reference: {featureIndex: 0}, before, after}]],
    history: {undo: [], redo: []}
  }}};
  await page.evaluate(draft => localStorage.setItem('kompas-editor-draft-v1', JSON.stringify(draft)), draft);
  await page.reload();
  await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
  await chooseMode(page, 'places.geojson');
  await expect(page.locator('#error')).toContainText('invalid visibilityLevel 99');
  await expect(page.locator('[data-mode="places.geojson"]')).toHaveAttribute('aria-pressed', 'true');
  await setView(page, before.geometry.coordinates, 17);
  await clickCoordinate(page, before.geometry.coordinates);
  await expect(page.locator('#selection-source')).toHaveText('places.geojson · feature 0');
});
