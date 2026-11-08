import {test, expect} from '@playwright/test';
import fileSystem from 'node:fs';

// Panel navigation keeps the same editing and review assertions usable at either viewport size.
async function openPanel(page, name) {
  const button = page.getByRole('button', {name, exact: true});
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}

async function uncoverMap(page) {
  const expandedButton = page.locator('[data-panel][aria-expanded="true"]');
  if (await expandedButton.count()) await expandedButton.click();
  const closeInspector = page.locator('#close-inspector');
  if (await closeInspector.isVisible()) await closeInspector.click();
}

async function openInspector(page) {
  const button = page.locator('#open-inspector');
  if (await button.isVisible()) await button.click();
}

// Every test edits through the real map and inspector, and asserts on what an export would contain.
test.describe('source editing', () => {
  const placesFile = 'places.geojson';
  const roadsFile = 'roads.geojson';
  const buildingsFile = 'buildings.geojson';
  const labelsFile = 'building-labels.geojson';
  const editedName = 'Edited by the browser test';

  const openEditor = async page => {
    await page.goto('./');
    await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
  };

  const fetchFeatures = async (page, filename) => {
    const response = await page.request.get(new URL(`sources/${filename}`, page.url()).href);
    return (await response.json()).features;
  };

  const chooseMode = async (page, filename) => {
    await openPanel(page, 'Layers');
    await page.locator(`[data-mode="${filename}"]`).click();
    await expect(page.locator('#status')).toContainText(`${filename} ·`);
    await expect(page.locator('#status')).toContainText('source features');
  };

  // No neighbour shares the click target, so the selection can only be this point.
  const isIsolatedAt = (features, index) => {
    const separationDegrees = 0.0004;
    const [longitude, latitude] = features[index].geometry.coordinates;
    return features.every((other, otherIndex) => {
      const [otherLongitude, otherLatitude] = other.geometry.coordinates;
      const distanceDegrees = Math.hypot(otherLongitude - longitude, otherLatitude - latitude);
      return otherIndex === index || distanceDegrees > separationDegrees;
    });
  };
  const isolatedPlaceIndex = features => features.findIndex((_feature, index) => isIsolatedAt(features, index));

  const centerMapOn = async (page, coordinate, zoom = 17) => {
    await page.evaluate(
      ({coordinate, zoom}) =>
        new Promise(resolve => {
          const {map} = window.editorDebug;
          map.once('idle', resolve);
          map.jumpTo({center: coordinate, zoom});
        }),
      {coordinate, zoom}
    );
  };

  // Screen position of a coordinate, on the page rather than within the map canvas.
  const screenPoint = async (page, coordinate) =>
    page.evaluate(coordinate => {
      const {map} = window.editorDebug;
      const {x, y} = map.project(coordinate);
      const bounds = map.getCanvas().getBoundingClientRect();
      return {x: bounds.left + x, y: bounds.top + y};
    }, coordinate);

  // Map interactions first close overlays so the selected coordinate is reachable.
  const tapMapAt = async (page, coordinate) => {
    await uncoverMap(page);
    await page.locator('#map').scrollIntoViewIfNeeded();
    const {x, y} = await screenPoint(page, coordinate);
    await page.mouse.click(x, y);
  };

  // A point this many pixels away from a coordinate, for a destination that stays on screen at any viewport.
  const coordinateOffsetBy = async (page, coordinate, xPixels, yPixels) =>
    page.evaluate(
      ({coordinate, xPixels, yPixels}) => {
        const {map} = window.editorDebug;
        const {x, y} = map.project(coordinate);
        return map.unproject([x + xPixels, y + yPixels]).toArray();
      },
      {coordinate, xPixels, yPixels}
    );

  // Presses anywhere on the map and drags by this many pixels with the left button.
  const dragMap = async (page, fromCoordinate, xPixels, yPixels) => {
    await uncoverMap(page);
    await page.locator('#map').scrollIntoViewIfNeeded();
    const start = await screenPoint(page, fromCoordinate);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + xPixels, start.y + yPixels, {steps: 4});
    await page.mouse.up();
  };

  const expectCoordinateNear = (actual, expected) => {
    const toleranceDegrees = 0.00002;
    expect(Math.abs(actual[0] - expected[0])).toBeLessThan(toleranceDegrees);
    expect(Math.abs(actual[1] - expected[1])).toBeLessThan(toleranceDegrees);
  };

  const selectPlace = async page => {
    await chooseMode(page, placesFile);
    const features = await fetchFeatures(page, placesFile);
    const index = isolatedPlaceIndex(features);
    expect(index).toBeGreaterThanOrEqual(0);
    await centerMapOn(page, features[index].geometry.coordinates);
    await expect(page.locator('#status')).toContainText('source features');
    await tapMapAt(page, features[index].geometry.coordinates);
    await expect(page.locator('#selection-source')).toHaveText(`${placesFile} · feature ${index}`);
    await expect(page.locator('#editor')).toBeVisible();
    return {index, feature: features[index], features};
  };

  const applyAndWait = async page => {
    await openInspector(page);
    await page.locator('#apply-edit').click();
    await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
    await expect(page.locator('#status')).toContainText('source features');
  };

  const exportChangeset = async (page, testInfo) => {
    await openPanel(page, 'Changes');
    await page.locator('#changeset-author').fill('Browser Test');
    await openPanel(page, 'Changes');
    await page.locator('#changeset-reason').fill('Acceptance test');
    const downloadPromise = page.waitForEvent('download');
    await openPanel(page, 'Changes');
    await page.locator('#export-changeset').click();
    const download = await downloadPromise;
    const savedPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(savedPath);
    return {savedPath, changeset: JSON.parse(fileSystem.readFileSync(savedPath))};
  };

  test('POI details round trip through export, and import resumes them on a clean session', {tag: '@phone'}, async ({
    page
  }, testInfo) => {
    await openEditor(page);
    const {index, feature} = await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    await openInspector(page);
    await page.locator('[name="visibilityLevel"]').selectOption('2');
    await applyAndWait(page);
    await expect(page.locator(`[data-changed-file="${placesFile}"] > h3`)).toHaveText(`${placesFile} · 1`);

    const {savedPath, changeset} = await exportChangeset(page, testInfo);
    expect(Object.keys(changeset.bases)).toEqual([placesFile]);
    const [operation] = changeset.operations;
    expect(operation.operation).toBe('modify');
    expect(operation.reference).toEqual({featureIndex: index});
    expect(operation.before).toEqual(feature);
    expect(operation.after.properties).toEqual({...feature.properties, name: editedName, visibilityLevel: 2});
    expect(operation.after.geometry).toEqual(feature.geometry);

    page.once('dialog', dialog => dialog.accept());
    await openPanel(page, 'Changes');
    await page.locator('#discard-changes').click();
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
    await openPanel(page, 'Changes');
    await page.locator('#import-changeset').setInputFiles(savedPath);
    await expect(page.locator(`[data-changed-file="${placesFile}"] > h3`)).toHaveText(`${placesFile} · 1`);
    await expect(page.locator('#review-message')).toContainText('Imported 1 changes');
  });

  test('resizing preserves the selected layer, unfinished edit and saved draft', {tag: '@phone'}, async ({page}) => {
    await openEditor(page);
    await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    const view = await page.evaluate(() => ({
      center: window.editorDebug.map.getCenter().toArray(),
      zoom: window.editorDebug.map.getZoom()
    }));
    await page.setViewportSize({width: 360, height: 740});
    await page.locator('#close-inspector').click();
    await page.getByRole('button', {name: 'Tools', exact: true}).click();
    await page.locator('#open-inspector').click();
    await expect(page.locator('[name="name"]')).toHaveValue(editedName);
    await expect(page.locator('#current-layer')).toHaveText('POIs');
    expect(await page.evaluate(() => ({
      center: window.editorDebug.map.getCenter().toArray(),
      zoom: window.editorDebug.map.getZoom()
    }))).toEqual(view);
    await openInspector(page);
    await page.locator('#apply-edit').click();
    await page.reload();
    await expect(page.locator('#review-message')).toHaveText('Restored your saved draft.');
    await page.getByRole('button', {name: 'Changes', exact: true}).click();
    await openPanel(page, 'Changes');
    await expect(page.locator('[data-changed-file="places.geojson"]')).toBeVisible();
  });

  test('selection and utility panels fit on narrow and wide windows', {tag: '@phone'}, async ({page}) => {
    await page.setViewportSize({width: 360, height: 740});
    await openEditor(page);
    await selectPlace(page);
    await page.locator('[name="name"]').fill(editedName);
    await openPanel(page, 'Tools');
    const selection = page.locator('#open-inspector');
    const panel = page.locator('#tools-panel');
    await expect(selection).toBeVisible();
    const selectionBounds = await selection.boundingBox();
    const panelBounds = await panel.boundingBox();
    expect(selectionBounds.y).toBeGreaterThanOrEqual(panelBounds.y + panelBounds.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.setViewportSize({width: 1800, height: 800});
    await selection.click();
    await expect(page.locator('.inspector')).toBeVisible();
    await expect(panel).toBeVisible();
    await expect(page.locator('[name="name"]')).toHaveValue(editedName);
    const inspectorBounds = await page.locator('.inspector').boundingBox();
    const widePanelBounds = await panel.boundingBox();
    expect(inspectorBounds.x - (widePanelBounds.x + widePanelBounds.width)).toBeGreaterThanOrEqual(1800 * 0.6);
  });

  test('invalid details are refused and record nothing', async ({page}) => {
    await openEditor(page);
    await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill('');
    await openInspector(page);
    await page.locator('#apply-edit').click();
    await expect(page.locator('#edit-problem')).toContainText('name must be nonempty');
    await page.getByRole('button', {name: 'Changes', exact: true}).click();
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
    await expect(page.locator('#undo')).toBeDisabled();
  });

  test('a changeset from another snapshot is refused whole', async ({page}, testInfo) => {
    await openEditor(page);
    const {feature} = await selectPlace(page);
    const refusedPath = testInfo.outputPath('other-snapshot.json');
    const changeset = {
      version: 1,
      bases: {[placesFile]: 'f'.repeat(64)},
      operations: [
        {filename: placesFile, operation: 'modify', reference: {featureIndex: 0}, before: feature, after: feature}
      ]
    };
    fileSystem.writeFileSync(refusedPath, JSON.stringify(changeset));
    await page.getByRole('button', {name: 'Changes', exact: true}).click();
    await openPanel(page, 'Changes');
    await page.locator('#import-changeset').setInputFiles(refusedPath);
    await expect(page.locator('#review-message')).toContainText('differs from this snapshot');
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
  });

  test('undo and redo stay within the active file, and an open edit blocks them', async ({page}) => {
    await openEditor(page);
    await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    await applyAndWait(page);
    await expect(page.locator('#undo')).toBeEnabled();

    await chooseMode(page, roadsFile);
    await expect(page.locator('#undo')).toBeDisabled();
    await chooseMode(page, placesFile);
    await expect(page.locator('#undo')).toBeEnabled();

    await openPanel(page, 'Tools');
    await page.locator('#undo').click();
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
    await expect(page.locator('#redo')).toBeEnabled();
    await openPanel(page, 'Tools');
    await page.locator('#redo').click();
    await openPanel(page, 'Changes');
    await expect(page.locator(`[data-changed-file="${placesFile}"]`)).toBeVisible();
    await expect(page.locator('#status')).toContainText('source features');

    const features = await fetchFeatures(page, placesFile);
    await tapMapAt(page, features[isolatedPlaceIndex(features)].geometry.coordinates);
    await openInspector(page);
    await page.locator('[name="name"]').fill('Still being typed');
    await expect(page.locator('#undo')).toBeDisabled();
    await openInspector(page);
    await page.locator('#cancel-edit').click();
    await expect(page.locator('#undo')).toBeEnabled();
  });

  test('typed details survive a mode switch until they are applied or discarded explicitly', async ({page}) => {
    await openEditor(page);
    await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    await openPanel(page, 'Layers');
    await page.locator(`[data-mode="${roadsFile}"]`).click();
    await expect(page.locator('#edit-problem')).toHaveText('Apply or Cancel the current edit first.');
    await expect(page.locator(`[data-mode="${placesFile}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[name="name"]')).toHaveValue(editedName);
    await openPanel(page, 'Layers');
    await page.locator('#browse').click();
    await expect(page.locator(`[data-mode="${placesFile}"]`)).toHaveAttribute('aria-pressed', 'true');
    await openInspector(page);
    await page.locator('#cancel-edit').click();
    await chooseMode(page, roadsFile);
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
  });

  test('Add POI waits for typed details, and for a new feature in progress', async ({page}) => {
    await openEditor(page);
    await selectPlace(page);
    await expect(page.locator('#add-feature')).toBeEnabled();
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    await expect(page.locator('#add-feature')).toBeDisabled();
    await expect(page.locator('[name="name"]')).toHaveValue(editedName);
    await openInspector(page);
    await page.locator('#cancel-edit').click();
    await openPanel(page, 'Tools');
    await page.locator('#add-feature').click();
    await expect(page.locator('#add-feature')).toBeDisabled();
    await openInspector(page);
    await page.locator('#cancel-edit').click();
    await expect(page.locator('#add-feature')).toBeEnabled();
  });

  test('a failed draft save is shown, because the work is not safe', async ({page}) => {
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => {
        throw new Error('quota exceeded');
      };
    });
    await openEditor(page);
    await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    await applyAndWait(page);
    await expect(page.locator('#error')).toContainText('Draft not saved: quota exceeded');
    await openPanel(page, 'Changes');
    await expect(page.locator(`[data-changed-file="${placesFile}"]`)).toBeVisible();
  });

  test('a draft that cannot be set aside blocks autosave, and can be downloaded or discarded', async ({page}) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('seeded')) {
        sessionStorage.setItem('seeded', '1');
        localStorage.setItem('kompas-editor-draft-v1', '{broken');
      }
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'kompas-editor-set-aside-drafts-v1') throw new Error('quota exceeded');
        return realSetItem.call(this, key, value);
      };
    });
    await page.goto('./');
    await expect(page.locator('#error')).toContainText('new changes will not be saved');
    await expect(page.locator('#draft-conflict')).toContainText('could not be set aside');
    await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    await applyAndWait(page);
    expect(await page.evaluate(() => localStorage.getItem('kompas-editor-draft-v1'))).toBe('{broken');

    const downloadPromise = page.waitForEvent('download');
    await openPanel(page, 'Changes');
    await page.locator('#draft-download').click();
    await downloadPromise;
    page.once('dialog', dialog => dialog.dismiss());
    await openPanel(page, 'Changes');
    await page.locator('#draft-discard').click();
    await expect(page.locator('#draft-conflict')).toBeVisible();
    page.once('dialog', dialog => dialog.accept());
    await openPanel(page, 'Changes');
    await page.locator('#draft-discard').click();
    await expect(page.locator('#draft-conflict')).toHaveAttribute('hidden', '');
    // Saved by the discard itself: nothing else has happened since the edit was applied.
    expect(await page.evaluate(() => localStorage.getItem('kompas-editor-draft-v1'))).toContain(editedName);
    await expect(page.locator('#error')).toBeHidden();
  });

  test('discarding an old draft to free storage retries the save before clearing the warning', async ({page}) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'kompas-editor-set-aside-drafts-v1',
        JSON.stringify([{reason: 'it is not readable', text: '{broken'}])
      );
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (window.isStorageFull) throw new Error('quota exceeded');
        return realSetItem.call(this, key, value);
      };
      window.isStorageFull = true;
    });
    await openEditor(page);
    await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    await applyAndWait(page);
    await expect(page.locator('#error')).toContainText('Draft not saved');

    page.once('dialog', dialog => dialog.accept());
    await openPanel(page, 'Changes');
    await page.locator('#draft-discard').click();
    await expect(page.locator('#error')).toContainText('Draft not saved');

    await page.evaluate(() => {
      window.isStorageFull = false;
    });
    await openPanel(page, 'Tools');
    await page.locator('#undo').click();
    await expect(page.locator('#error')).toBeHidden();
    await openPanel(page, 'Tools');
    await page.locator('#redo').click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('kompas-editor-draft-v1'))).toContain(editedName);
  });

  test('losing the window in the middle of a drag restores the preview', async ({page}) => {
    await openEditor(page);
    const {feature} = await selectPlace(page);
    await openInspector(page);
    await page.locator('#tool-move').click();
    await page.locator('#map').scrollIntoViewIfNeeded();
    const start = await screenPoint(page, feature.geometry.coordinates);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y, {steps: 2});
    await expect(page.locator('#export-changeset')).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.mouse.move(start.x + 80, start.y, {steps: 2});
    await page.mouse.up();
    await openInspector(page);
    await page.locator('#apply-edit').click();
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
    await expect(page.locator('#undo')).toBeDisabled();
  });

  test('a second finger interrupts a swipe and restores the preview', {tag: '@phone'}, async ({page, hasTouch}) => {
    test.skip(!hasTouch, 'Touch input exists only in the phone project.');
    await openEditor(page);
    const {feature} = await selectPlace(page);
    await openInspector(page);
    await page.locator('#tool-move').click();
    await page.locator('#map').scrollIntoViewIfNeeded();
    const start = await screenPoint(page, feature.geometry.coordinates);
    const browser = await page.context().newCDPSession(page);
    const firstFinger = xOffset => ({x: start.x + xOffset, y: start.y, id: 1});
    const secondFinger = {x: start.x + 40, y: start.y + 40, id: 2};
    const touch = (type, touchPoints) => browser.send('Input.dispatchTouchEvent', {type, touchPoints});
    await touch('touchStart', [firstFinger(0)]);
    await touch('touchMove', [firstFinger(30)]);
    await touch('touchStart', [firstFinger(30), secondFinger]);
    await touch('touchEnd', []);
    await openInspector(page);
    await page.locator('#apply-edit').click();
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
  });

  test('a moving preview is dropped by a mode switch, and records nothing', async ({page}) => {
    await openEditor(page);
    const {feature} = await selectPlace(page);
    await openInspector(page);
    await page.locator('#tool-move').click();
    await dragMap(page, feature.geometry.coordinates, 70, 0);
    await chooseMode(page, roadsFile);
    await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
  });

  test('an open edit blocks export, import and discarding until it is applied or cancelled', async ({page}) => {
    await openEditor(page);
    await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    await applyAndWait(page);
    await expect(page.locator('#export-changeset')).toBeEnabled();
    await expect(page.locator('#discard-changes')).toBeEnabled();
    const features = await fetchFeatures(page, placesFile);
    await tapMapAt(page, features[isolatedPlaceIndex(features)].geometry.coordinates);
    await openInspector(page);
    await page.locator('[name="name"]').fill('Second thoughts');
    await expect(page.locator('#export-changeset')).toBeDisabled();
    await expect(page.locator('#discard-changes')).toBeDisabled();
    await expect(page.locator('#import-changeset')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#export-changeset')).toBeEnabled();
    await expect(page.locator('#import-changeset')).toBeEnabled();
  });

  test('pending changes can be reviewed and exported from Browse, but no feature can be edited there', async ({
    page
  }) => {
    await openEditor(page);
    const {feature} = await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    await applyAndWait(page);
    await openPanel(page, 'Layers');
    await page.locator('#browse').click();
    await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
    await tapMapAt(page, feature.geometry.coordinates);
    await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
    await expect(page.locator('#undo')).toBeDisabled();
    await expect(page.locator('#add-feature')).toHaveAttribute('hidden', '');
    await expect(page.locator('#export-changeset')).toBeEnabled();
    await openPanel(page, 'Changes');
    await expect(page.locator(`[data-changed-file="${placesFile}"]`)).toBeVisible();
  });

  test('applying an unchanged form records nothing', async ({page}) => {
    await openEditor(page);
    await selectPlace(page);
    await openInspector(page);
    await page.locator('#apply-edit').click();
    await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
    await expect(page.locator('#undo')).toBeDisabled();
  });

  test('a placeholder address and a reserved level are refused at Apply', async ({page}) => {
    await openEditor(page);
    const labels = await fetchFeatures(page, labelsFile);
    await chooseMode(page, labelsFile);
    await centerMapOn(page, labels[0].geometry.coordinates, 18);
    await expect(page.locator('#status')).toContainText('source features');
    await tapMapAt(page, labels[0].geometry.coordinates);
    await openInspector(page);
    await page.locator('[name="addr:housenumber"]').fill('n/a');
    await openInspector(page);
    await page.locator('#apply-edit').click();
    await expect(page.locator('#edit-problem')).toContainText('placeholder');
    await openInspector(page);
    await page.locator('#cancel-edit').click();

    const places = await fetchFeatures(page, placesFile);
    const nonLandmark = places.findIndex(
      (place, index, features) => place.properties.category === 'food' && isIsolatedAt(features, index)
    );
    await chooseMode(page, placesFile);
    await centerMapOn(page, places[nonLandmark].geometry.coordinates);
    await expect(page.locator('#status')).toContainText('source features');
    await tapMapAt(page, places[nonLandmark].geometry.coordinates);
    await openInspector(page);
    await page.locator('[name="visibilityLevel"]').selectOption('1');
    await openInspector(page);
    await page.locator('#apply-edit').click();
    await expect(page.locator('#edit-problem')).toContainText('reserved for sights landmarks');
  });

  test('a typed edit is not lost to a stray tap, and Cancel and Escape discard it', async ({page}) => {
    await openEditor(page);
    const {feature} = await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    const emptyCoordinate = await coordinateOffsetBy(page, feature.geometry.coordinates, 60, 60);
    await tapMapAt(page, emptyCoordinate);
    await expect(page.locator('#status')).toHaveText('Apply or Cancel the current edit first.');
    await expect(page.locator('[name="name"]')).toHaveValue(editedName);
    await page.keyboard.press('Escape');
    await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
  });

  test('a draft survives a reload', async ({page}) => {
    await openEditor(page);
    await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    await applyAndWait(page);
    await page.reload();
    await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
    await expect(page.locator('#review-message')).toHaveText('Restored your saved draft.');
    await openPanel(page, 'Changes');
    await expect(page.locator(`[data-changed-file="${placesFile}"]`)).toBeVisible();
    await chooseMode(page, placesFile);
    await expect(page.locator('#undo')).toBeEnabled();
  });

  test('a draft from another snapshot is offered back, never applied', async ({page}) => {
    await openEditor(page);
    await page.evaluate(placesFile => {
      const files = {[placesFile]: {base: 'f'.repeat(64), changes: [], history: {undo: [], redo: []}}};
      localStorage.setItem('kompas-editor-draft-v1', JSON.stringify({version: 1, files}));
    }, placesFile);
    await page.reload();
    await expect(page.locator('#draft-conflict')).toContainText(placesFile);
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();

    await selectPlace(page);
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    await applyAndWait(page);
    await page.reload();
    await expect(page.locator('#draft-conflict')).toContainText(placesFile);
    await expect(page.locator('#review-message')).toHaveText('Restored your saved draft.');

    const downloadPromise = page.waitForEvent('download');
    await openPanel(page, 'Changes');
    await page.locator('#draft-download').click();
    await downloadPromise;
    page.once('dialog', dialog => dialog.accept());
    await openPanel(page, 'Changes');
    await page.locator('#draft-discard').click();
    await expect(page.locator('#draft-conflict')).toHaveAttribute('hidden', '');
    await page.reload();
    await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
    await expect(page.locator('#draft-conflict')).toHaveAttribute('hidden', '');
    await openPanel(page, 'Changes');
    await expect(page.locator(`[data-changed-file="${placesFile}"]`)).toBeVisible();
  });

  test('an unreadable draft is offered back instead of stopping the editor', async ({page}) => {
    await openEditor(page);
    await page.evaluate(() => localStorage.setItem('kompas-editor-draft-v1', '{broken'));
    await page.reload();
    await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
    await expect(page.locator('#draft-conflict')).toContainText('not readable');
    await expect(page.locator('#error')).toBeHidden();
  });

  test('a POI moves by relative drags from anywhere, with no jump and no ghost', async ({page}, testInfo) => {
    await openEditor(page);
    const {index, feature} = await selectPlace(page);
    const origin = feature.geometry.coordinates;
    const expected = await coordinateOffsetBy(page, origin, 90, 0);
    const pressPoint = await coordinateOffsetBy(page, origin, -60, 50);
    await openInspector(page);
    await page.locator('#tool-move').click();
    await dragMap(page, pressPoint, 70, 0);
    await dragMap(page, pressPoint, 20, 0);
    await expect(page.locator('#export-changeset')).toBeDisabled();
    await applyAndWait(page);
    const renderedAtOldPosition = await page.evaluate(
      ({origin, index}) => {
        const {map} = window.editorDebug;
        const features = map.queryRenderedFeatures(map.project(origin), {layers: ['editor-source-point']});
        return features.filter(hit => hit.id === index).length;
      },
      {origin, index}
    );
    expect(renderedAtOldPosition).toBe(0);
    const {changeset} = await exportChangeset(page, testInfo);
    const {after} = changeset.operations[0];
    expect(after.properties).toEqual(feature.properties);
    expectCoordinateNear(after.geometry.coordinates, expected);
  });

  test('Escape in the middle of a drag ends the edit cleanly', async ({page}) => {
    const scriptErrors = [];
    page.on('pageerror', error => scriptErrors.push(error.message));
    await openEditor(page);
    const {feature} = await selectPlace(page);
    await openInspector(page);
    await page.locator('#tool-move').click();
    await page.locator('#map').scrollIntoViewIfNeeded();
    const start = await screenPoint(page, feature.geometry.coordinates);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 30, start.y, {steps: 2});
    await page.keyboard.press('Escape');
    await page.mouse.move(start.x + 60, start.y, {steps: 2});
    await page.mouse.up();
    await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
    expect(scriptErrors).toEqual([]);
  });

  test('a touch swipe moves relatively, and an interrupted one restores its start', {tag: '@phone'}, async ({
    page,
    hasTouch
  }, testInfo) => {
    test.skip(!hasTouch, 'Touch input exists only in the phone project.');
    await openEditor(page);
    const {feature} = await selectPlace(page);
    const expected = await coordinateOffsetBy(page, feature.geometry.coordinates, 60, 0);
    const pressPoint = await coordinateOffsetBy(page, feature.geometry.coordinates, -40, 40);
    await openInspector(page);
    await page.locator('#tool-move').click();
    await uncoverMap(page);
    await page.locator('#map').scrollIntoViewIfNeeded();
    const start = await screenPoint(page, pressPoint);
    const browser = await page.context().newCDPSession(page);
    const touch = (type, xOffset) =>
      browser.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{x: start.x + xOffset, y: start.y}]
      });
    const swipe = async (endType, distance) => {
      await touch('touchStart', 0);
      for (const fraction of [0.25, 0.5, 1]) await touch('touchMove', distance * fraction);
      await touch(endType, distance);
    };
    await swipe('touchEnd', 60);
    await swipe('touchCancel', 120);
    await openInspector(page);
    await expect(page.locator('#apply-edit')).toBeVisible();
    await applyAndWait(page);
    const {changeset} = await exportChangeset(page, testInfo);
    expectCoordinateNear(changeset.operations[0].after.geometry.coordinates, expected);
  });

  test('a new POI gets a local identity, and deleting a source POI can be undone', async ({page}, testInfo) => {
    await openEditor(page);
    const {feature} = await selectPlace(page);
    await openInspector(page);
    await page.locator('#delete-feature').click();
    await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
    await expect(page.locator(`[data-changed-file="${placesFile}"] summary`)).toContainText('delete');
    await openPanel(page, 'Tools');
    await page.locator('#undo').click();
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
    await expect(page.locator('#status')).toContainText('source features');

    await openPanel(page, 'Tools');
    await page.locator('#add-feature').click();
    await expect(page.locator('#add-feature')).toHaveText('Add POI');
    await openInspector(page);
    await page.locator('[name="name"]').fill('');
    await openInspector(page);
    await page.locator('#apply-edit').click();
    await expect(page.locator('#edit-problem')).toContainText('Tap the map');
    await tapMapAt(page, await coordinateOffsetBy(page, feature.geometry.coordinates, 70, 40));
    await openInspector(page);
    await page.locator('[name="name"]').fill(editedName);
    await openInspector(page);
    await page.locator('[name="kind"]').fill('cafe');
    await openInspector(page);
    await page.locator('#apply-edit').click();
    await expect(page.locator('#edit-problem')).toContainText('category is required');
    await openInspector(page);
    await page.locator('[name="category"]').selectOption('food');
    await openInspector(page);
    await page.locator('#apply-edit').click();
    await expect(page.locator('#edit-problem')).toContainText('visibilityLevel is required');
    await openInspector(page);
    await page.locator('[name="visibilityLevel"]').selectOption('4');
    await applyAndWait(page);

    const {changeset} = await exportChangeset(page, testInfo);
    const [operation] = changeset.operations;
    expect(operation.operation).toBe('add');
    expect(operation.reference.localId).toMatch(/^local:/);
    expect(operation.after.properties.id).toBe(operation.reference.localId);
    expect(operation.after.properties.source).toBe('Local correction');
    expect(operation.after.properties.osm_id).toBeUndefined();
    expect(operation.after.properties.visibilityLevel).toBe(4);
    expect(operation.before).toBeNull();
  });

  test('a road is drawn as one line, and a single point is refused', async ({page}, testInfo) => {
    await openEditor(page);
    await chooseMode(page, roadsFile);
    const center = [19.2594, 42.4411];
    await centerMapOn(page, center, 18);
    await expect(page.locator('#status')).toContainText('source features');
    await expect(page.locator('#add-feature')).toHaveText('Draw road');
    await openPanel(page, 'Tools');
    await page.locator('#add-feature').click();
    await openInspector(page);
    await page.locator('[name="kind"]').selectOption('footway');
    await tapMapAt(page, center);
    await openInspector(page);
    await page.locator('#apply-edit').click();
    await expect(page.locator('#edit-problem')).toContainText('at least two points');
    await tapMapAt(page, await coordinateOffsetBy(page, center, 60, 30));
    await applyAndWait(page);
    const {changeset} = await exportChangeset(page, testInfo);
    const [operation] = changeset.operations;
    expect(operation.filename).toBe(roadsFile);
    expect(operation.operation).toBe('add');
    expect(operation.after.properties.kind).toBe('footway');
    expect(operation.after.geometry.coordinates).toHaveLength(2);
  });

  test('the preview shows every pending edit in the public cartography, and ends on a mode switch', async ({page}) => {
    const renderedCount = (layerId, center) =>
      page.evaluate(
        ({layerId, center}) => {
          const {map} = window.editorDebug;
          const point = map.project(center);
          const around = [
            [point.x - 40, point.y - 40],
            [point.x + 80, point.y + 60]
          ];
          return map.queryRenderedFeatures(around, {layers: [layerId]}).length;
        },
        {layerId, center}
      );
    await openEditor(page);
    const {feature} = await selectPlace(page);
    // The public map labels a place with its English name when it has one.
    await openInspector(page);
    await page.locator('[name="name:en"]').fill(editedName);
    await applyAndWait(page);
    await chooseMode(page, roadsFile);
    const center = [19.2594, 42.4411];
    await centerMapOn(page, center, 18);
    await expect(page.locator('#status')).toContainText('source features');
    await openPanel(page, 'Tools');
    await page.locator('#add-feature').click();
    await openInspector(page);
    await page.locator('[name="kind"]').selectOption('footway');
    await tapMapAt(page, center);
    await tapMapAt(page, await coordinateOffsetBy(page, center, 60, 30));
    await applyAndWait(page);

    await openPanel(page, 'Tools');
    await page.locator('#preview').click();
    await expect(page.locator('#tools-panel')).toBeVisible();
    await expect(page.locator('#preview')).toBeFocused();
    await expect(page.locator('#preview')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#status')).toHaveText('Preview · edits in 2 files applied');
    await expect.poll(() => renderedCount('edit-preview-footways', center)).toBeGreaterThan(0);
    // The source holds only what the tiles around the view need, so look where the place is.
    await centerMapOn(page, feature.geometry.coordinates);
    const previewedPlaceName = () =>
      page.evaluate(
        id =>
          window.editorDebug.map
            .querySourceFeatures('places')
            .find(marker => JSON.parse(marker.properties.activeIds).includes(id))?.properties.label,
        feature.properties.id
      );
    await expect.poll(previewedPlaceName).toBe(editedName);
    await centerMapOn(page, center, 18);

    await openPanel(page, 'Tools');
    await page.locator('#preview').click();
    await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
    await expect.poll(() => renderedCount('footways', center)).toBeGreaterThan(0);
    expect(await page.evaluate(() => Boolean(window.editorDebug.map.getLayer('edit-preview-footways')))).toBe(false);

    await openPanel(page, 'Tools');
    await page.locator('#preview').click();
    await expect(page.locator('#preview')).toHaveAttribute('aria-pressed', 'true');
    await chooseMode(page, roadsFile);
    await expect(page.locator('#preview')).toHaveAttribute('aria-pressed', 'false');
    expect(await page.evaluate(() => Boolean(window.editorDebug.map.getLayer('edit-preview-footways')))).toBe(false);
  });

  // A simple footprint, so that one moved corner can only produce a valid shape.
  const selectNumberedBuilding = async page => {
    const maxSimpleRingLength = 7;
    const labels = await fetchFeatures(page, labelsFile);
    const footprints = await fetchFeatures(page, buildingsFile);
    const labelIndex = labels.findIndex(({properties}) => {
      const [outerRing] = footprints[properties.footprintIndex].geometry.coordinates;
      return outerRing.length <= maxSimpleRingLength;
    });
    const label = labels[labelIndex];
    const footprintIndex = label.properties.footprintIndex;
    await chooseMode(page, buildingsFile);
    await centerMapOn(page, label.geometry.coordinates, 18);
    await expect(page.locator('#status')).toContainText('source features');
    await tapMapAt(page, label.geometry.coordinates);
    await expect(page.locator('#selection-source')).toHaveText(`${buildingsFile} · feature ${footprintIndex}`);
    return {label, labelIndex, footprint: footprints[footprintIndex], footprintIndex};
  };

  test('moving a footprint blocks the export until its label is corrected in its own mode', async ({
    page
  }, testInfo) => {
    await openEditor(page);
    const {label, labelIndex, footprint, footprintIndex} = await selectNumberedBuilding(page);
    const dragPixels = 150;
    await openInspector(page);
    await page.locator('#tool-move').click();
    await expect(page.locator('#tool-move')).toHaveText('Move whole shape');
    await dragMap(page, label.geometry.coordinates, dragPixels, 0);
    await applyAndWait(page);
    await expect(page.locator('#review-problems')).toContainText(`outside footprint ${footprintIndex}`);
    await expect(page.locator('#export-changeset')).toBeDisabled();
    await expect(page.locator(`[data-changed-file="${labelsFile}"]`)).toHaveCount(0);

    await chooseMode(page, labelsFile);
    await expect(page.locator('#status')).toContainText('source features');
    await tapMapAt(page, label.geometry.coordinates);
    await expect(page.locator('#selection-source')).toHaveText(`${labelsFile} · feature ${labelIndex}`);
    await openInspector(page);
    await page.locator('#tool-move').click();
    await dragMap(page, label.geometry.coordinates, dragPixels, 0);
    await applyAndWait(page);
    await expect(page.locator('#review-problems')).toBeEmpty();

    const {changeset} = await exportChangeset(page, testInfo);
    expect(changeset.operations.map(({filename}) => filename).toSorted()).toEqual(
      [labelsFile, buildingsFile].toSorted()
    );
    const footprintOperation = changeset.operations.find(({filename}) => filename === buildingsFile);
    const ring = footprintOperation.after.geometry.coordinates[0];
    expect(ring[0]).toEqual(ring.at(-1));
    expect(ring).toHaveLength(footprint.geometry.coordinates[0].length);
  });

  test('footprint corners are edited through handles and stay a closed ring', async ({page}, testInfo) => {
    await openEditor(page);
    const {footprint} = await selectNumberedBuilding(page);
    const corner = footprint.geometry.coordinates[0][0];
    await openInspector(page);
    await page.locator('#tool-vertices').click();
    await expect(page.locator('#vertex-insert')).toBeVisible();
    await openInspector(page);
    await page.locator('#vertex-insert').click();
    await expect(page.locator('#edit-problem')).toHaveText('Select a corner or point first.');
    await tapMapAt(page, corner);
    await openInspector(page);
    await page.locator('#vertex-insert').click();
    await applyAndWait(page);
    const {changeset} = await exportChangeset(page, testInfo);
    const ring = changeset.operations[0].after.geometry.coordinates[0];
    expect(ring).toHaveLength(footprint.geometry.coordinates[0].length + 1);
    expect(ring[0]).toEqual(ring.at(-1));
  });

  test('a dragged corner moves with its closing coordinate, and the map itself stays still', async ({
    page
  }, testInfo) => {
    await openEditor(page);
    const {footprint} = await selectNumberedBuilding(page);
    const [outerRing] = footprint.geometry.coordinates;
    const corner = outerRing[0];
    const corners = outerRing.slice(0, -1);
    const middle = axis => corners.reduce((total, point) => total + point[axis], 0) / corners.length;
    const outward = await page.evaluate(
      ({corner, center}) => {
        const {map} = window.editorDebug;
        const cornerPoint = map.project(corner);
        const centerPoint = map.project(center);
        const length = Math.hypot(cornerPoint.x - centerPoint.x, cornerPoint.y - centerPoint.y);
        return {x: (cornerPoint.x - centerPoint.x) / length, y: (cornerPoint.y - centerPoint.y) / length};
      },
      {corner, center: [middle(0), middle(1)]}
    );
    const dragPixels = 12;
    const mapCenterBefore = await page.evaluate(() => window.editorDebug.map.getCenter().toArray());
    await openInspector(page);
    await page.locator('#tool-vertices').click();
    await uncoverMap(page);
    await page.locator('#map').scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        page.evaluate(() => window.editorDebug.map.queryRenderedFeatures({layers: ['editor-handles-point']}).length)
      )
      .toBeGreaterThan(0);
    const start = await screenPoint(page, corner);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + outward.x * dragPixels, start.y + outward.y * dragPixels, {steps: 4});
    await page.mouse.up();
    expect(await page.evaluate(() => window.editorDebug.map.getCenter().toArray())).toEqual(mapCenterBefore);
    await applyAndWait(page);
    const {changeset} = await exportChangeset(page, testInfo);
    const ring = changeset.operations[0].after.geometry.coordinates[0];
    expect(ring).toHaveLength(outerRing.length);
    expect(ring[0]).not.toEqual(corner);
    expect(ring[0]).toEqual(ring.at(-1));
    expect(ring.slice(1, -1)).toEqual(outerRing.slice(1, -1));
  });

  test('an open edit never widens the page, which would misplace every touch on a phone', {tag: '@phone'}, async ({page}) => {
    await openEditor(page);
    await selectPlace(page);
    const overflowPixels = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflowPixels).toBe(0);
  });

  test('selecting an inspect-only feature closes the previous editor', async ({page}) => {
    await openEditor(page);
    await chooseMode(page, 'land.geojson');
    const land = await fetchFeatures(page, 'land.geojson');
    const parkCenter = land.find(({properties, geometry}) => properties.kind === 'park' && geometry.type === 'Polygon');
    const corners = parkCenter.geometry.coordinates[0].slice(0, -1);
    const middle = axis => corners.reduce((total, corner) => total + corner[axis], 0) / corners.length;
    const parkPoint = [middle(0), middle(1)];
    await centerMapOn(page, parkPoint, 16);
    await expect(page.locator('#status')).toContainText('source features');
    await tapMapAt(page, parkPoint);
    await expect(page.locator('#editor')).toBeVisible();
    await expect(page.locator('#lock-reason')).toHaveAttribute('hidden', '');
    await openInspector(page);
    await page.locator('#cancel-edit').click();
    const country = land.find(({properties}) => properties.kind === 'context');
    const countryPoint = country.geometry.coordinates[0][0];
    await centerMapOn(page, countryPoint, 8);
    await expect(page.locator('#status')).toContainText('source features');
    await tapMapAt(page, countryPoint);
    await expect(page.locator('#lock-reason')).toContainText('Country shapes');
    await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
  });

  test('read-only files explain themselves and offer no editing', async ({page}) => {
    await openEditor(page);
    await chooseMode(page, 'transport-stops.geojson');
    await expect(page.locator('#status')).toContainText('read-only');
    await expect(page.locator('#lock-reason')).toContainText('transit import');
    await expect(page.locator('#add-feature')).toHaveAttribute('hidden', '');
    await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
  });
});
