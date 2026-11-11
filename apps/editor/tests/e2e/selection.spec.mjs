import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const coordinate = [19.259, 42.441];

// A synthetic, hash-pinned bundle gives the real renderer exactly co-located POIs without changing reviewed data.
async function openOverlappingPlaces(page, count = 2) {
  const source = JSON.parse(readFileSync(new URL('../../../../dist/editor/sources/places.geojson', import.meta.url)));
  const features = Array.from({length: count}, (_, index) => ({
    ...source.features[index],
    geometry: {type: 'Point', coordinates: coordinate},
    properties: {...source.features[index].properties, name: `Overlap ${index + 1}`}
  }));
  features.push({...source.features[count],
    geometry: {type: 'Point', coordinates: [18.5, 43]},
    properties: {...source.features[count].properties, name: 'Outside view'}});
  const body = JSON.stringify({...source, features});
  await page.route('**/sources/places.geojson', route => route.fulfill({body, contentType: 'application/json'}));
  await page.route('**/sources/manifest.json', async route => {
    const response = await route.fetch();
    const manifest = await response.json();
    const metadata = manifest.layers.find(layer => layer.filename === 'places.geojson');
    Object.assign(metadata, {bytes: Buffer.byteLength(body), featureCount: features.length,
      sha256: createHash('sha256').update(body).digest('hex')});
    await route.fulfill({json: manifest});
  });
  await page.goto('./');
  await expect(page.locator('#status')).toHaveText('Browse · all source files locked');
  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await page.locator('[data-mode="places.geojson"]').click();
  await expect(page.locator('#status')).toContainText('source features');
  await page.evaluate(coordinate => new Promise(resolve => {
    const {map} = window.editorDebug;
    map.once('idle', resolve);
    map.jumpTo({center: coordinate, zoom: 18});
  }), coordinate);
}

async function tapOverlap(page) {
  const canvas = page.locator('.maplibregl-canvas');
  const bounds = await canvas.boundingBox();
  const position = {x: bounds.width / 2, y: bounds.height / 2};
  if (test.info().project.use.hasTouch) await canvas.tap({position});
  else await canvas.click({position});
}

async function chooseWithKeyboard(page, number) {
  await page.locator('#open-objects').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#objects-heading')).toHaveText('Objects in view');
  // Opening the list transfers focus directly to its first object.
  await expect(page.getByRole('button', {name: 'Overlap 1 · Point · feature 0', exact: true})).toBeFocused();
  if (number === 2) await page.keyboard.press('Tab');
  await page.keyboard.press(number === 2 ? 'Space' : 'Enter');
}

// Separate pointer cases start fresh touch gesture state, so rapid automated taps cannot become a double-tap zoom.
for (const number of [1, 2]) {
  test(`co-located POI ${number} can be selected by pointer`, {tag: '@phone'}, async ({page}, testInfo) => {
    await openOverlappingPlaces(page);
    await tapOverlap(page);
    await expect(page.locator('#objects-heading')).toHaveText('Choose an object here');
    await expect(page.locator('#objects-list button')).toHaveCount(2);
    await expect(page.locator('#selection-title')).toHaveText('Select an object');
    await page.screenshot({path: testInfo.outputPath('overlapping-objects.png')});
    const choice = page.getByRole('button', {name: `Overlap ${number} · Point · feature ${number - 1}`, exact: true});
    if (testInfo.project.use.hasTouch) await choice.tap();
    else await choice.click();
    await expect(page.locator('#selection-title')).toHaveText(`Overlap ${number}`);
    await expect(page.locator('#selection-source')).toHaveText(`places.geojson · feature ${number - 1}`);
  });
}

test('co-located POIs can each be selected with Tab and Enter or Space', {tag: '@phone'}, async ({page}) => {
  await openOverlappingPlaces(page);
  for (const number of [1, 2]) {
    await chooseWithKeyboard(page, number);
    await expect(page.locator('#selection-title')).toHaveText(`Overlap ${number}`);
    await expect(page.locator('#close-inspector')).toBeFocused();
    await page.locator('#cancel-edit').click();
  }
  await page.locator('#open-objects').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(page.locator('#objects-panel')).toBeHidden();
  await expect(page.locator('#open-objects')).toBeFocused();
});

test('the view list follows camera and layer changes and preserves unfinished edits', {tag: '@phone'}, async ({page}) => {
  await openOverlappingPlaces(page);
  await chooseWithKeyboard(page, 1);
  await page.locator('[name="name"]').fill('Unapplied name');
  await page.locator('#open-objects').click();
  await expect(page.locator('#objects-list button')).toHaveCount(2);
  await expect(page.locator('#objects-list')).not.toContainText('Outside view');
  await page.getByRole('button', {name: 'Overlap 2 · Point · feature 1', exact: true}).click();
  await expect(page.locator('#status')).toHaveText('Apply or Cancel the current edit first.');
  await page.locator('#open-inspector').click();
  await expect(page.locator('[name="name"]')).toHaveValue('Unapplied name');
  await page.locator('#cancel-edit').click();
  await page.locator('#open-objects').click();
  await page.evaluate(() => window.editorDebug.map.jumpTo({center: [18.5, 43]}));
  await expect(page.locator('#objects-list button')).toHaveText(['Outside view · Point · feature 2']);
  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await page.locator('#browse').click();
  await page.locator('#open-objects').click();
  await expect(page.locator('#objects-status')).toHaveText('Choose a layer to list its objects.');
  await expect(page.locator('#objects-list button')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await page.locator('[data-mode="transport-stops.geojson"]').click();
  await expect(page.locator('#status')).toContainText('source features');
  await page.locator('#open-objects').click();
  await expect(page.locator('#objects-list')).not.toContainText('Overlap');
});

test('large view lists keep every co-located object reachable on keyboard pages', {tag: '@phone'}, async ({page}) => {
  await openOverlappingPlaces(page, 45);
  await page.locator('#open-objects').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#objects-status')).toHaveText('1–40 of 45 objects');
  await page.getByRole('button', {name: 'Next objects', exact: true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#objects-status')).toHaveText('41–45 of 45 objects');
  await expect(page.getByRole('button', {name: 'Overlap 41 · Point · feature 40', exact: true})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#selection-title')).toHaveText('Overlap 41');
});

test('list selection keeps original references after deletion and refreshes applied names', {tag: '@phone'}, async ({page}) => {
  await openOverlappingPlaces(page);
  await chooseWithKeyboard(page, 1);
  await page.locator('#delete-feature').click();
  await expect(page.locator('#status')).toContainText('source features');
  await page.locator('#open-objects').click();
  const remaining = page.getByRole('button', {name: 'Overlap 2 · Point · feature 1', exact: true});
  await expect(page.locator('#objects-list button')).toHaveCount(1);
  await remaining.press('Enter');
  await expect(page.locator('#selection-source')).toHaveText('places.geojson · feature 1');
  await page.locator('[name="name"]').fill('Renamed overlap');
  await page.locator('#apply-edit').click();
  await expect(page.locator('#status')).toContainText('source features');
  await page.locator('#open-objects').click();
  await expect(page.locator('#objects-list button')).toHaveText(['Renamed overlap · Point · feature 1']);
});

test('single-hit map selection preserves a utility panel on a wide window', {tag: '@phone'}, async ({page}) => {
  await page.setViewportSize({width: 1800, height: 800});
  await openOverlappingPlaces(page);
  await page.evaluate(() => new Promise(resolve => {
    const {map} = window.editorDebug;
    map.once('idle', resolve);
    map.jumpTo({center: [18.5, 43]});
  }));
  await page.getByRole('button', {name: 'Changes', exact: true}).click();
  await tapOverlap(page);
  await expect(page.locator('#selection-title')).toHaveText('Outside view');
  await expect(page.locator('#changes-panel')).toBeVisible();
  await expect(page.locator('.inspector')).toBeVisible();
  await page.locator('#cancel-edit').click();
  await page.locator('#open-objects').click();
  await page.getByRole('button', {name: 'Outside view · Point · feature 2', exact: true}).click();
  await expect(page.locator('#objects-panel')).toBeHidden();
  await expect(page.locator('.inspector')).toBeVisible();
});

test('clicking empty map clears the previous location chooser', {tag: '@phone'}, async ({page}) => {
  await openOverlappingPlaces(page);
  await tapOverlap(page);
  await expect(page.locator('#objects-heading')).toHaveText('Choose an object here');
  const canvas = page.locator('.maplibregl-canvas');
  const bounds = await canvas.boundingBox();
  const emptyOffsetPixels = 60;
  await canvas.click({position: {x: bounds.width / 2 + emptyOffsetPixels, y: bounds.height / 2}});
  await expect(page.locator('#objects-panel')).toBeHidden();
  await expect(page.locator('#selection-title')).toHaveText('Select an object');
  await page.locator('#open-objects').click();
  await expect(page.locator('#objects-heading')).toHaveText('Objects in view');
  await expect(page.locator('#objects-list button')).toHaveCount(2);
});

test('opening Objects during mode loading focuses the first object once it is ready', {tag: '@phone'}, async ({page}) => {
  await openOverlappingPlaces(page);
  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await page.locator('#browse').click();
  // Hold the completion notification while the real worker loads, so this interaction has no timing race.
  await page.evaluate(() => {
    const {map} = window.editorDebug;
    const originalFire = map.fire;
    map.fire = function(event, ...argumentsAfterEvent) {
      const type = typeof event === 'string' ? event : event.type;
      if (type === 'idle') return this;
      return originalFire.call(this, event, ...argumentsAfterEvent);
    };
    window.releaseModeIdle = () => {
      map.fire = originalFire;
      map.fire('idle');
    };
  });
  await page.getByRole('button', {name: 'Layers', exact: true}).click();
  await page.locator('[data-mode="places.geojson"]').click();
  await page.locator('#open-objects').click();
  await expect(page.locator('#objects-status')).toHaveText('Loading objects…');
  await expect(page.locator('#objects-status')).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.editorDebug.map.isSourceLoaded('editor-source'))).toBe(true);
  await page.evaluate(() => {
    window.releaseModeIdle();
    delete window.releaseModeIdle;
  });
  await expect(page.getByRole('button', {name: 'Overlap 1 · Point · feature 0', exact: true})).toBeFocused();
});
