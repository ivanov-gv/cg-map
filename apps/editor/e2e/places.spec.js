import {test, expect} from '@playwright/test';
import {exportChangeset} from '../tests/e2e/city-steps.mjs';
import {browseStatus, deleteObject, layerButton, leaveMode} from '../tests/e2e/workspace.mjs';

const placesFile = 'places.geojson';
const editedName = 'Edited by the whole-app test';
const isPhone = testInfo => testInfo.project.name === 'pages-mobile';

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

// An object with source identity is exported by that identity, not by its position in the snapshot.
function expectedReferenceOf(feature, index) {
  const {entityId, entityPart} = feature.properties;
  if (entityId === undefined) return {featureIndex: index};
  return entityPart === undefined ? {entityId} : {entityId, entityPart};
}

function isIsolatedAt(features, index) {
  const separationDegrees = 0.0004;
  const [longitude, latitude] = features[index].geometry.coordinates;
  return features.every((other, otherIndex) => {
    const [otherLongitude, otherLatitude] = other.geometry.coordinates;
    const distanceDegrees = Math.hypot(otherLongitude - longitude, otherLatitude - latitude);
    return otherIndex === index || distanceDegrees > separationDegrees;
  });
}

// Places are few enough that the app holds them all, but only the source file is fetched here.
async function selectPlace(page, chooseLayer = true) {
  if (chooseLayer) {
    await openPanel(page, 'Layers');
    await layerButton(page, placesFile).click();
    await expect(page.locator('#status')).toContainText('objects');
  }
  const response = await page.request.get(new URL(`sources/${placesFile}`, page.url()).href);
  const features = (await response.json()).features;
  const index = features.findIndex((_feature, position) => isIsolatedAt(features, position));
  expect(index).toBeGreaterThanOrEqual(0);
  await page.evaluate(
    ({coordinate}) =>
      new Promise(resolve => {
        const {map} = window.editorDebug;
        map.once('idle', resolve);
        map.jumpTo({center: coordinate, zoom: 17});
      }),
    {coordinate: features[index].geometry.coordinates}
  );
  await uncoverMap(page);
  const {x, y} = await page.evaluate(coordinate => {
    const {map} = window.editorDebug;
    const point = map.project(coordinate);
    const bounds = map.getCanvas().getBoundingClientRect();
    return {x: bounds.left + point.x, y: bounds.top + point.y};
  }, features[index].geometry.coordinates);
  await page.mouse.click(x, y);
  await expect(page.locator('#selection-source')).toHaveText(`${placesFile} · feature ${index}`);
  await expect(page.locator('#editor')).toBeVisible();
  return {index, feature: features[index]};
}

async function openInspector(page) {
  await leaveMode(page);
  const button = page.locator('#open-inspector');
  if (await button.isVisible()) await button.click();
}

async function applyAndWait(page) {
  await openInspector(page);
  await page.locator('#apply-edit').click();
  await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
  await expect(page.locator('#status')).toContainText('objects');
}

// The one whole-app place journey: startup, source identity on deletion, and a real export, discard and import. The
// component cases in src/layers/places cover the fields, hours, drags and building membership without this startup.
test('a source place can be deleted or marked and undone, and its details survive export and import', {
  tag: '@phone'
}, async ({page}, testInfo) => {
  await page.goto('./');
  await expect(page.locator('#status')).toHaveText(browseStatus);
  const {index, feature} = await selectPlace(page);
  await openInspector(page);

  if (isPhone(testInfo)) {
    // The mark stays for the desk; only the mark itself is taken back here.
    await expect(page.locator('#delete-feature')).toHaveText('Mark for deletion');
    await deleteObject(page);
    await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
    await expect(page.locator('#toast')).toContainText('Marked for deletion');
    await openPanel(page, 'Changes');
    await expect(page.locator('#field-items')).toContainText('Marked for deletion');
    await expect(page.locator('#change-count')).toHaveText('1');
    await page.locator('#toast-action').click();
    await expect(page.locator('#field-items li')).toHaveCount(0);
    await expect(page.locator('#review-empty')).toBeVisible();
    await expect(page.locator('#status')).toContainText('objects');
  } else {
    await deleteObject(page);
    await expect(page.locator('#editor')).toHaveAttribute('hidden', '');
    await expect(page.locator(`[data-changed-file="${placesFile}"] .review-stacked-list > li > details > summary`)).toContainText('delete');
    await openPanel(page, 'Tools');
    await page.locator('#undo').click();
    await openPanel(page, 'Changes');
    await expect(page.locator('#review-empty')).toBeVisible();
    await expect(page.locator('#status')).toContainText('objects');
  }

  // Undo closes the inspector; reopen the source place before changing its details. The layer is already chosen.
  await selectPlace(page, false);
  await openInspector(page);
  await page.locator('[name="name"]').fill(editedName);
  await page.locator('[name="visibilityLevel"]').selectOption('2');
  await applyAndWait(page);
  await expect(page.locator(`[data-changed-file="${placesFile}"] > h3`)).toHaveText(`${placesFile} · 1 change`);

  const {savedPath, changeset} = await exportChangeset(page, testInfo);
  expect(Object.keys(changeset.bases)).toEqual([placesFile]);
  const [operation] = changeset.operations;
  expect(operation.operation).toBe('modify');
  expect(operation.reference).toEqual(expectedReferenceOf(feature, index));
  expect(operation.before).toEqual(feature);
  expect(operation.after.properties).toEqual({...feature.properties, name: editedName, visibilityLevel: 2});
  expect(operation.after.geometry).toEqual(feature.geometry);

  page.once('dialog', dialog => dialog.accept());
  await openPanel(page, 'Changes');
  await page.locator('#review-secondary summary').click();
  await page.locator('#discard-changes').click();
  await openPanel(page, 'Changes');
  await expect(page.locator('#review-empty')).toBeVisible();
  await openPanel(page, 'Changes');
  await page.locator('#review-secondary summary').click();
  await page.locator('#import-changeset').setInputFiles(savedPath);
  await expect(page.locator(`[data-changed-file="${placesFile}"] > h3`)).toHaveText(`${placesFile} · 1 change`);
  await expect(page.locator('#review-message')).toContainText('Imported 1 changes');
});
