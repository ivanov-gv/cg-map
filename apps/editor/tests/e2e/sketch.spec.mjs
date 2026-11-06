import {readFile, readdir} from 'node:fs/promises';
import {test, expect} from '@playwright/test';

// The draft is deliberately outside the deployed public artifact.
test.describe('internal editor sketch', () => {
  const draftURL = new URL('../../prototypes/editor.html', import.meta.url);

  // Exercise the unshipped sketch directly, independently of the deployed map artifact.
  test.beforeEach(async ({page}) => {
    await page.route('**/editor-draft.html', async route => {
      await route.fulfill({contentType: 'text/html', body: await readFile(draftURL, 'utf8')});
    });
    await page.goto('editor-draft.html');
  });

  // Read rendered geometry so selection exercises the same object hit area as a real pointer.
  async function selectObject(page, objectId) {
    await page.locator('#canvas').scrollIntoViewIfNeeded();
    const screenPosition = await page
      .locator(`#features [data-object="${objectId}"] > :first-child`)
      .evaluate(element => {
        const elementTagName = element.tagName;
        const geometryBounds = element.getBBox();
        let horizontalPixels;
        let verticalPixels;
        if (elementTagName === 'circle') {
          horizontalPixels = element.cx.baseVal.value;
          verticalPixels = element.cy.baseVal.value;
        } else if (['rect', 'polygon'].includes(elementTagName)) {
          horizontalPixels = geometryBounds.x + geometryBounds.width / 4;
          verticalPixels = geometryBounds.y + geometryBounds.height / 2;
        } else {
          const selectablePoint = element.points.getItem(1);
          horizontalPixels = selectablePoint.x;
          verticalPixels = selectablePoint.y;
        }
        const screenPoint = new DOMPoint(horizontalPixels, verticalPixels).matrixTransform(element.getScreenCTM());
        return {x: screenPoint.x, y: screenPoint.y};
      });
    if (test.info().project.use.hasTouch) await page.touchscreen.tap(screenPosition.x, screenPosition.y);
    else await page.mouse.click(screenPosition.x, screenPosition.y);
  }

  // Creation still uses click/tap; movement scenarios below use native held-pointer gestures.
  async function clickMapPoint(page, horizontalPixels, verticalPixels) {
    await page.locator('#canvas').scrollIntoViewIfNeeded();
    const screenPosition = await mapPointScreenPosition(page, horizontalPixels, verticalPixels);
    if (test.info().project.use.hasTouch) await page.touchscreen.tap(screenPosition.x, screenPosition.y);
    else await page.mouse.click(screenPosition.x, screenPosition.y);
  }

  // Keep geometry expectations in schematic coordinates even when the viewport crops the SVG.
  async function mapPointScreenPosition(page, horizontalPixels, verticalPixels) {
    return page.locator('#canvas').evaluate(
      (canvas, coordinates) => {
        const screenPoint = new DOMPoint(...coordinates).matrixTransform(canvas.getScreenCTM());
        return {x: screenPoint.x, y: screenPoint.y};
      },
      [horizontalPixels, verticalPixels]
    );
  }

  // Use browser-native touch input and detach each session when its gesture ends.
  async function startMapDrag(page, horizontalPixels, verticalPixels) {
    await page.locator('#canvas').scrollIntoViewIfNeeded();
    const startPosition = await mapPointScreenPosition(page, horizontalPixels, verticalPixels);
    const touchSession = test.info().project.use.hasTouch ? await page.context().newCDPSession(page) : null;
    await page.locator('#canvas').evaluate(canvas => {
      canvas.addEventListener(
        'pointerdown',
        event => {
          canvas.dataset.testPointer = event.pointerId;
        },
        {once: true}
      );
    });
    if (touchSession) {
      await touchSession.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [startPosition]});
    } else {
      await page.mouse.move(startPosition.x, startPosition.y);
      await page.mouse.down();
    }
    return {
      async move(nextHorizontalPixels, nextVerticalPixels) {
        const screenPosition = await mapPointScreenPosition(page, nextHorizontalPixels, nextVerticalPixels);
        if (touchSession)
          await touchSession.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [screenPosition]});
        else await page.mouse.move(screenPosition.x, screenPosition.y, {steps: 4});
      },
      async release() {
        if (touchSession) {
          await touchSession.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
          await touchSession.detach();
        } else await page.mouse.up();
      },
      async cancel() {
        if (touchSession) {
          await touchSession.send('Input.dispatchTouchEvent', {type: 'touchCancel', touchPoints: []});
          await touchSession.detach();
        } else {
          const pointerId = Number(await page.locator('#canvas').getAttribute('data-test-pointer'));
          await page.locator('#canvas').dispatchEvent('pointercancel', {pointerId, pointerType: 'mouse'});
          await page.mouse.up();
        }
      }
    };
  }

  // Read actual rendered positions rather than exposing draft state to the tests.
  async function pointPosition(page, objectId = 'demo-cafe') {
    return page
      .locator(`#features [data-object="${objectId}"] > circle`)
      .evaluate(circle => [circle.cx.baseVal.value, circle.cy.baseVal.value]);
  }

  // Assert the downloaded record, not merely the review panel or an internal object array.
  async function exportedDraft(page) {
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', {name: 'Export draft JSON'}).click();
    const download = await downloaded;
    const stream = await download.createReadStream();
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }

  test('draft has exactly one switch and table row per source GeoJSON', async ({page}) => {
    const sourceDirectory = new URL('../../../../data/sources/', import.meta.url);
    const sourceFiles = (await readdir(sourceDirectory)).filter(filename => filename.endsWith('.geojson')).sort();
    const table = page.getByRole('table', {name: 'Map layers'});
    await expect(table).toBeVisible();
    await expect(page.locator('#objects')).toHaveCount(0);
    await expect(page.getByRole('heading', {name: 'Sample objects'})).toHaveCount(0);
    const switches = page.locator('[data-mode]');
    await expect(switches).toHaveCount(sourceFiles.length);
    const modeFiles = await switches.evaluateAll(buttons => buttons.map(button => button.dataset.mode).sort());
    expect(modeFiles).toEqual(sourceFiles);
    expect((await table.getByRole('rowheader').allTextContents()).sort()).toEqual(sourceFiles);
    for (const filename of sourceFiles) {
      const button = page.locator('[data-mode="' + filename + '"]');
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-mode][aria-pressed="true"]')).toHaveCount(1);
      await expect(table.getByRole('row', {name: filename + ' On', exact: true})).toBeAttached();
      await button.click();
      await expect(page.locator('[data-mode][aria-pressed="true"]')).toHaveCount(0);
    }
    await page.locator('[data-mode="places.geojson"]').click();
    await expect(table.getByRole('row', {name: 'places.geojson On', exact: true})).toBeAttached();
    await expect(table.getByRole('row', {name: 'roads.geojson Locked', exact: true})).toBeAttached();
  });

  test('draft roads and paths share one file mode with a creation subtype choice', async ({page}) => {
    await page.locator('[data-mode="roads.geojson"]').click();
    for (const objectId of ['demo-road', 'demo-path']) {
      await selectObject(page, objectId);
      await expect(page.locator('#move')).toBeEnabled();
      await expect(page.getByRole('button', {name: 'Insert vertex'})).toBeEnabled();
      await expect(page.locator('#selection-id')).toContainText('roads.geojson');
    }
    await page.locator('#new-line-type').selectOption('path');
    await page.locator('#add').click();
    await clickMapPoint(page, 550, 350);
    await clickMapPoint(page, 650, 400);
    await page.locator('#finish').click();
    const draft = await exportedDraft(page);
    expect(draft.version).toBe(2);
    expect(draft.changes[0]).toMatchObject({
      layer: 'roads.geojson',
      operation: 'add',
      after: {layer: 'roads.geojson', type: 'path'}
    });
  });

  test('draft moves track held drags and multiple swipes until Done records one change', async ({page}) => {
    await page.locator('[data-mode="places.geojson"]').click();
    await selectObject(page, 'demo-cafe');
    await page.locator('#move').click();
    await clickMapPoint(page, 600, 400);
    expect(await pointPosition(page)).toEqual([565, 325]);
    await expect(page.locator('#done-move')).toBeDisabled();
    const first = await startMapDrag(page, 500, 350);
    await first.move(520, 370);
    expect(await pointPosition(page)).toEqual([585, 345]);
    await expect(page.locator('#canvas')).toHaveAttribute('data-dragging', 'true');
    await first.move(535, 385);
    expect(await pointPosition(page)).toEqual([600, 360]);
    await first.release();
    await expect(page.locator('#canvas')).toHaveAttribute('data-dragging', 'false');
    await expect(page.locator('#move-controls')).toBeVisible();
    await expect(page.locator('#change-count')).toHaveText('0 changes');
    await expect(page.locator('#export')).toBeDisabled();
    await expect(page.locator('#undo')).toBeDisabled();
    const second = await startMapDrag(page, 500, 350);
    await second.move(510, 400);
    expect(await pointPosition(page)).toEqual([610, 410]);
    await second.release();
    await expect(page.locator('#change-count')).toHaveText('0 changes');
    await page.getByRole('button', {name: 'Done', exact: true}).click();
    await expect(page.locator('#move-controls')).toBeHidden();
    const draft = await exportedDraft(page);
    expect(draft.changes).toHaveLength(1);
    expect(draft.changes[0].before.points).toEqual([[565, 325]]);
    expect(draft.changes[0].after.points).toEqual([[610, 410]]);
    await page.locator('#undo').click();
    expect(await pointPosition(page)).toEqual([565, 325]);
    await expect(page.locator('#change-count')).toHaveText('0 changes');
    await expect(page.locator('#undo')).toBeDisabled();
    await page.locator('#redo').click();
    expect(await pointPosition(page)).toEqual([610, 410]);
  });

  test('draft Cancel, Escape and mode switches discard movement previews', async ({page}) => {
    await page.locator('[data-mode="places.geojson"]').click();
    await selectObject(page, 'demo-cafe');
    for (const end of ['cancel', 'escape', 'mode']) {
      await page.locator('#move').click();
      const drag = await startMapDrag(page, 500, 350);
      await drag.move(535, 385);
      await drag.release();
      expect(await pointPosition(page)).toEqual([600, 360]);
      if (end === 'cancel') await page.locator('#cancel-move').click();
      else if (end === 'escape') await page.keyboard.press('Escape');
      else await page.locator('[data-mode="roads.geojson"]').click();
      expect(await pointPosition(page)).toEqual([565, 325]);
      await expect(page.locator('#change-count')).toHaveText('0 changes');
      await expect(page.locator('#move-controls')).toBeHidden();
      await expect(page.locator('#undo')).toBeDisabled();
    }
  });

  test('draft interrupted gestures restore their start while earlier adjustments stay pending', async ({page}) => {
    await page.locator('[data-mode="places.geojson"]').click();
    await selectObject(page, 'demo-cafe');
    await page.locator('#move').click();
    const first = await startMapDrag(page, 500, 350);
    await first.move(520, 370);
    await first.release();
    const interrupted = await startMapDrag(page, 500, 350);
    await interrupted.move(535, 385);
    expect(await pointPosition(page)).toEqual([620, 380]);
    await interrupted.cancel();
    expect(await pointPosition(page)).toEqual([585, 345]);
    await expect(page.locator('#change-count')).toHaveText('0 changes');
    await expect(page.locator('#move-controls')).toBeVisible();
    await page.locator('#done-move').click();
    const draft = await exportedDraft(page);
    expect(draft.changes[0].after.points).toEqual([[585, 345]]);
  });

  test('draft file modes gate inspector and geometry tools', async ({page}) => {
    await expect(page.locator('#add')).toBeDisabled();
    await selectObject(page, 'demo-cafe');
    await expect(page.locator('#name')).toBeDisabled();
    await expect(page.locator('#delete')).toBeDisabled();
    await page.locator('[data-mode="places.geojson"]').click();
    await expect(page.locator('#name')).toBeEnabled();
    await page.locator('#name').fill('Unapplied name');
    await page.locator('[data-mode="roads.geojson"]').click();
    await expect(page.locator('#name')).toHaveValue('Corner café');
    await expect(page.locator('#name')).toBeDisabled();
    await expect(page.locator('#move')).toBeDisabled();
    await expect(page.locator('#delete')).toBeDisabled();
    await expect(page.locator('#change-count')).toHaveText('0 changes');
    await page.locator('[data-mode="roads.geojson"]').click();
    await expect(page.locator('#mode-label')).toHaveText('Browse · editing off');
    await expect(page.locator('#add')).toBeDisabled();
  });

  test('draft POI details and position survive mode changes and export before/after', async ({page}) => {
    await page.locator('[data-mode="places.geojson"]').click();
    await selectObject(page, 'demo-cafe');
    await page.locator('#name').fill('Updated café');
    await page.locator('#visibility').selectOption('1');
    await page.getByRole('button', {name: 'Apply details'}).click();
    await page.locator('#move').click();
    const drag = await startMapDrag(page, 500, 350);
    await drag.move(535, 435);
    await drag.release();
    await page.getByRole('button', {name: 'Done', exact: true}).click();
    await page.locator('#browse').click();
    const draft = await exportedDraft(page);
    expect(draft.fictional).toBe(true);
    expect(draft.coordinateSpace).toContain('NOT GeoJSON');
    expect(draft.changes).toHaveLength(1);
    expect(draft.changes[0].before.name).toBe('Corner café');
    expect(draft.changes[0].after).toMatchObject({name: 'Updated café', visibilityLevel: 1, points: [[600, 410]]});
    await page.locator('#review').click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.locator('#review-content')).toContainText('Updated café');
    await page.getByRole('button', {name: 'Close', exact: true}).click();
  });

  test('draft new POI deletion and history require the matching mode', async ({page}) => {
    await page.locator('[data-mode="places.geojson"]').click();
    await page.locator('#add').click();
    await clickMapPoint(page, 600, 410);
    await expect(page.locator('#selection-title')).toHaveText('New POI');
    const added = await exportedDraft(page);
    expect(added.changes[0].operation).toBe('add');
    expect(added.changes[0].after.id).toMatch(/^demo-local-/);
    await page.locator('#delete').click();
    await expect(page.locator('#change-count')).toHaveText('0 changes');
    await page.locator('#browse').click();
    await expect(page.locator('#undo')).toBeDisabled();
    await page.locator('[data-mode="roads.geojson"]').click();
    await expect(page.locator('#undo')).toBeDisabled();
    await page.locator('[data-mode="places.geojson"]').click();
    await page.locator('#undo').click();
    await expect(page.locator('#change-count')).toHaveText('1 change');
    await expect(page.locator('#mode-label')).toHaveText('POIs · editing on');
    await page.locator('#redo').click();
    await expect(page.locator('#change-count')).toHaveText('0 changes');
  });

  // The rendered polygon includes its closing coordinate, which the handle list must omit.
  async function footprintPosition(page) {
    return page.locator('[data-object="demo-building"] > polygon').evaluate(polygon =>
      Array.from({length: polygon.points.numberOfItems}, (_, index) => {
        const point = polygon.points.getItem(index);
        return [point.x, point.y];
      })
    );
  }

  test('draft building corners move with Done, closed rings, history and mode guards', async ({page}) => {
    const originalFootprint = [
      [520, 190],
      [600, 190],
      [600, 255],
      [520, 255],
      [520, 190]
    ];
    await selectObject(page, 'demo-building');
    await expect(page.locator('#move')).toBeDisabled();
    await expect(page.locator('#move-building')).toBeDisabled();
    await page.locator('[data-mode="buildings.geojson"]').click();
    await expect(page.locator('#vertex-list button')).toHaveCount(4);
    await page.getByRole('button', {name: 'Vertex 1', exact: true}).click();
    await page.locator('#move').click();
    const drag = await startMapDrag(page, 500, 350);
    await drag.move(480, 330);
    const reshapedFootprint = [
      [500, 170],
      [600, 190],
      [600, 255],
      [520, 255],
      [500, 170]
    ];
    expect(await footprintPosition(page)).toEqual(reshapedFootprint);
    await drag.release();
    await expect(page.locator('#change-count')).toHaveText('0 changes');
    await page.locator('#done-move').click();
    const draft = await exportedDraft(page);
    expect(draft.changes).toHaveLength(1);
    expect(draft.changes[0].before.points).toEqual(originalFootprint);
    expect(draft.changes[0].after).toMatchObject({points: reshapedFootprint, layer: 'buildings.geojson'});
    expect(draft.changes[0].after).not.toHaveProperty('street');
    expect(draft.changes[0].after).not.toHaveProperty('number');
    expect(await pointPosition(page, 'demo-building-label')).toEqual([560, 222.5]);
    await page.locator('#undo').click();
    expect(await footprintPosition(page)).toEqual(originalFootprint);
    await page.locator('#redo').click();
    expect(await footprintPosition(page)).toEqual(reshapedFootprint);
    await page.locator('[data-mode="places.geojson"]').click();
    await expect(page.locator('#move')).toBeDisabled();
    await expect(page.locator('#move-building')).toBeDisabled();
    await expect(page.getByRole('button', {name: 'Insert vertex'})).toBeDisabled();
  });

  test('draft building insertion wraps the closing edge and removal stops at a triangle', async ({page}) => {
    await page.locator('[data-mode="buildings.geojson"]').click();
    await selectObject(page, 'demo-building');
    await page.getByRole('button', {name: 'Vertex 4', exact: true}).click();
    await page.getByRole('button', {name: 'Insert vertex'}).click();
    await expect(page.locator('#vertex-list button')).toHaveCount(5);
    expect(await footprintPosition(page)).toEqual([
      [520, 190],
      [600, 190],
      [600, 255],
      [520, 255],
      [520, 222.5],
      [520, 190]
    ]);
    await page.locator('#undo').click();
    await expect(page.locator('#vertex-list button')).toHaveCount(4);
    // Undo removes the inserted last vertex; the remaining final corner must stay selectable.
    await expect(page.getByRole('button', {name: 'Vertex 4', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#redo').click();
    await page.getByRole('button', {name: 'Vertex 5', exact: true}).click();
    await page.getByRole('button', {name: 'Remove vertex'}).click();
    await page.getByRole('button', {name: 'Vertex 1', exact: true}).click();
    await page.getByRole('button', {name: 'Remove vertex'}).click();
    await expect(page.locator('#vertex-list button')).toHaveCount(3);
    await expect(page.getByRole('button', {name: 'Remove vertex'})).toBeDisabled();
    const draft = await exportedDraft(page);
    expect(draft.changes[0].after.points).toEqual([
      [600, 190],
      [600, 255],
      [520, 255],
      [600, 190]
    ]);
    await page.locator('#undo').click();
    await expect(page.locator('#vertex-list button')).toHaveCount(4);
  });

  test('draft rejects crossed, duplicate and zero-area building corners without recording moves', async ({page}) => {
    const originalFootprint = [
      [520, 190],
      [600, 190],
      [600, 255],
      [520, 255],
      [520, 190]
    ];
    await page.locator('[data-mode="buildings.geojson"]').click();
    await selectObject(page, 'demo-building');
    for (const invalidFootprintCase of [
      {endPosition: [380, 385], expectedMessage: /cannot cross/},
      {endPosition: [420, 350], expectedMessage: /distinct/}
    ]) {
      await page.getByRole('button', {name: 'Vertex 2', exact: true}).click();
      await page.locator('#move').click();
      const drag = await startMapDrag(page, 500, 350);
      await drag.move(...invalidFootprintCase.endPosition);
      await drag.release();
      await page.locator('#done-move').click();
      await expect(page.locator('#status')).toContainText(invalidFootprintCase.expectedMessage);
      await expect(page.locator('#move-controls')).toBeVisible();
      await expect(page.locator('#change-count')).toHaveText('0 changes');
      await expect(page.locator('#export')).toBeDisabled();
      await page.locator('#cancel-move').click();
      expect(await footprintPosition(page)).toEqual(originalFootprint);
    }
    await page.getByRole('button', {name: 'Vertex 1', exact: true}).click();
    await page.getByRole('button', {name: 'Remove vertex'}).click();
    await page.getByRole('button', {name: 'Vertex 1', exact: true}).click();
    await page.locator('#move').click();
    const drag = await startMapDrag(page, 500, 350);
    await drag.move(460, 415);
    await drag.release();
    await page.locator('#done-move').click();
    await expect(page.locator('#status')).toContainText('nonzero area');
    await expect(page.locator('#change-count')).toHaveText('1 change');
    await page.keyboard.press('Escape');
    await page.locator('#undo').click();
    expect(await footprintPosition(page)).toEqual(originalFootprint);
    await expect(page.locator('#change-count')).toHaveText('0 changes');
  });

  test('draft whole-building moves translate only the footprint source', async ({page}) => {
    await page.locator('[data-mode="buildings.geojson"]').click();
    await selectObject(page, 'demo-building');
    await page.locator('#move-building').click();
    const drag = await startMapDrag(page, 500, 350);
    await drag.move(530, 390);
    const translatedFootprint = [
      [550, 230],
      [630, 230],
      [630, 295],
      [550, 295],
      [550, 230]
    ];
    expect(await footprintPosition(page)).toEqual(translatedFootprint);
    await drag.release();
    await expect(page.locator('#change-count')).toHaveText('0 changes');
    await page.locator('#done-move').click();
    const draft = await exportedDraft(page);
    expect(draft.changes).toHaveLength(1);
    expect(draft.changes[0]).toMatchObject({layer: 'buildings.geojson', after: {points: translatedFootprint}});
    expect(draft.changes[0].after).not.toHaveProperty('street');
    expect(draft.changes[0].after).not.toHaveProperty('number');
    expect(await pointPosition(page, 'demo-building-label')).toEqual([560, 222.5]);
    await page.locator('#undo').click();
    expect(await footprintPosition(page)).toEqual(draft.changes[0].before.points);
  });

  test('draft building-label mode changes only the address point, not its footprint', async ({page}) => {
    const originalFootprint = await footprintPosition(page);
    await page.locator('[data-mode="buildings.geojson"]').click();
    await selectObject(page, 'demo-building-label');
    await expect(page.locator('#street')).toBeDisabled();
    await expect(page.locator('#move')).toBeDisabled();
    await page.locator('[data-mode="building-labels.geojson"]').click();
    await expect(page.locator('#street')).toBeEnabled();
    await expect(page.locator('#name-field')).toBeHidden();
    await expect(page.locator('#geometry-fields')).toBeHidden();
    await expect(page.locator('#move-building')).toBeHidden();
    await page.locator('#number').fill('14A');
    await page.locator('#street').fill('New street');
    await page.getByRole('button', {name: 'Apply details'}).click();
    const draft = await exportedDraft(page);
    expect(draft.changes).toHaveLength(1);
    expect(draft.changes[0]).toMatchObject({
      layer: 'building-labels.geojson',
      after: {type: 'address', street: 'New street', number: '14A'}
    });
    expect(draft.changes[0].after.points).toEqual(draft.changes[0].before.points);
    expect(await footprintPosition(page)).toEqual(originalFootprint);
    await selectObject(page, 'demo-building');
    await expect(page.locator('#move')).toBeDisabled();
    await expect(page.locator('#move-building')).toBeDisabled();
    await expect(page.locator('#building-fields')).toBeHidden();
  });

  test('draft footprint and label moves use separate modes, exports and undo guards', async ({page}) => {
    const originalFootprint = await footprintPosition(page);
    await page.locator('[data-mode="buildings.geojson"]').click();
    await selectObject(page, 'demo-building');
    await expect(page.locator('#building-fields')).toBeHidden();
    await page.locator('#move-building').click();
    const footprintDrag = await startMapDrag(page, 500, 350);
    await footprintDrag.move(530, 390);
    await footprintDrag.release();
    await page.locator('#done-move').click();
    const movedFootprint = await footprintPosition(page);
    expect(await pointPosition(page, 'demo-building-label')).toEqual([560, 222.5]);
    await selectObject(page, 'demo-building-label');
    await expect(page.locator('#move')).toBeDisabled();
    await page.locator('[data-mode="building-labels.geojson"]').click();
    await expect(page.locator('#street')).toHaveValue('Garden street');
    await expect(page.locator('#number')).toHaveValue('12');
    await page.locator('#move').click();
    const labelDrag = await startMapDrag(page, 500, 350);
    await labelDrag.move(510, 360);
    await labelDrag.release();
    await page.locator('#done-move').click();
    expect(await footprintPosition(page)).toEqual(movedFootprint);
    const draft = await exportedDraft(page);
    expect(draft.changes).toHaveLength(2);
    expect(draft.changes.map(change => change.layer).sort()).toEqual(['building-labels.geojson', 'buildings.geojson']);
    const labelChange = draft.changes.find(change => change.layer === 'building-labels.geojson');
    expect(labelChange.after).toMatchObject({points: [[570, 232.5]], street: 'Garden street', number: '12'});
    await page.locator('#undo').click();
    expect(await pointPosition(page, 'demo-building-label')).toEqual([560, 222.5]);
    expect(await footprintPosition(page)).toEqual(movedFootprint);
    await expect(page.locator('#undo')).toBeDisabled();
    await page.locator('[data-mode="buildings.geojson"]').click();
    await page.locator('#undo').click();
    expect(await footprintPosition(page)).toEqual(originalFootprint);
    await expect(page.locator('#change-count')).toHaveText('0 changes');
  });

  test('draft path vertex tools, drawing and cancellation preserve recorded changes', async ({page}) => {
    await page.locator('[data-mode="roads.geojson"]').click();
    await selectObject(page, 'demo-path');
    await page.getByRole('button', {name: 'Vertex 2', exact: true}).click();
    await page.getByRole('button', {name: 'Insert vertex'}).click();
    await expect(page.locator('#vertex-list button')).toHaveCount(5);
    await page.locator('#move').click();
    const drag = await startMapDrag(page, 500, 350);
    await drag.move(500, 400);
    await drag.release();
    await expect(page.getByRole('button', {name: 'Remove vertex'})).toBeDisabled();
    await page.getByRole('button', {name: 'Done', exact: true}).click();
    await page.getByRole('button', {name: 'Remove vertex'}).click();
    await expect(page.locator('#vertex-list button')).toHaveCount(4);
    await page.locator('#undo').click();
    await expect(page.locator('#vertex-list button')).toHaveCount(5);
    await page.locator('#new-line-type').selectOption('path');
    await page.locator('#add').click();
    await clickMapPoint(page, 550, 350);
    await expect(page.locator('#finish')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#finish')).toBeHidden();
    await page.locator('#add').click();
    await clickMapPoint(page, 550, 350);
    await clickMapPoint(page, 650, 400);
    await page.locator('#finish').click();
    const draft = await exportedDraft(page);
    expect(draft.changes).toHaveLength(2);
    expect(draft.changes.find(change => change.operation === 'add').after).toMatchObject({
      type: 'path',
      points: [
        [550, 350],
        [650, 400]
      ]
    });
    expect(draft.changes.find(change => change.id === 'demo-path').after.points).toContainEqual([650, 250]);
  });
});

// The independent consumers share the core artifact without importing public-app workflows.
