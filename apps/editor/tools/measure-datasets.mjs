#!/usr/bin/env node
// Measures how the editor copes with source files larger than today's, using the built artifact in a real browser. Each
// larger file repeats its features at an offset, so nothing is written to data/sources and the map itself stays the same.
// Usage: make -C apps/editor measure-datasets [FACTORS="1 2 4 8"]. Results and their date live in README.md.
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fileSystem from 'node:fs';
import {fileURLToPath} from 'node:url';

const artifactSources = fileURLToPath(new URL('../../../dist/editor/sources/', import.meta.url));
const serverTool = fileURLToPath(new URL('../../../platform/tools/serve.py', import.meta.url));
const port = Number(process.env.MEASURE_PORT ?? 9899);
const pageURL = `http://127.0.0.1:${port}/`;
// The two largest files, and the two whose whole geometry the editor draws as an overlay.
const measuredModes = ['buildings.geojson', 'roads.geojson'];
// Far enough that a repeat does not sit on the original, and small enough to stay valid coordinates.
const repeatOffsetDegrees = 0.01;
const serverStartMilliseconds = 2000;
const longOperationMilliseconds = 300000;
const browserArguments = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const offsetCoordinates = (coordinates, offsetDegrees) =>
  typeof coordinates[0] === 'number'
    ? [coordinates[0] + offsetDegrees, coordinates[1]]
    : coordinates.map(part => offsetCoordinates(part, offsetDegrees));

// Originals come first, so that indices into them stay valid. Other files keep their joins by staying as they are.
function repeatedCollection(collection, factor) {
  const features = Array.from({length: factor}, (_unused, repeat) =>
    collection.features.map(feature => ({
      ...feature,
      geometry: {
        ...feature.geometry,
        coordinates: offsetCoordinates(feature.geometry.coordinates, repeat * repeatOffsetDegrees)
      }
    }))
  ).flat();
  return {...collection, features};
}

// The source files of one size, and the manifest that makes the editor accept them.
function scaledBundle(factor) {
  const manifest = JSON.parse(fileSystem.readFileSync(`${artifactSources}manifest.json`));
  const filesByName = new Map();
  for (const layer of manifest.layers) {
    const original = fileSystem.readFileSync(artifactSources + layer.filename);
    const isScaled = measuredModes.includes(layer.filename);
    const collection = isScaled ? repeatedCollection(JSON.parse(original), factor) : null;
    const bytes = isScaled ? Buffer.from(JSON.stringify(collection)) : original;
    filesByName.set(layer.filename, bytes);
    layer.bytes = bytes.byteLength;
    layer.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    if (isScaled) layer.featureCount = collection.features.length;
  }
  filesByName.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
  return filesByName;
}

async function timed(operation) {
  const startedAt = performance.now();
  await operation();
  return Math.round(performance.now() - startedAt);
}

const usedHeapMegabytes = page =>
  page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1024 / 1024));

async function openMode(page, filename) {
  await page.locator(`[data-mode="${filename}"]`).click();
  await page.locator('#status').filter({hasText: `${filename} ·`}).filter({hasText: 'source features'}).waitFor({
    timeout: longOperationMilliseconds
  });
}

// One fresh page for one size. Workers are blocked, as in the browser tests, so the bundle comes from the route below.
async function measure(browser, factor) {
  const bundle = scaledBundle(factor);
  const context = await browser.newContext({serviceWorkers: 'block', viewport: {width: 1280, height: 800}});
  const page = await context.newPage();
  await page.route('**/sources/*', route => {
    const filename = new URL(route.request().url()).pathname.split('/').pop();
    return route.fulfill({body: bundle.get(filename), contentType: 'application/json'});
  });
  const result = {factor};
  result.startupMilliseconds = await timed(async () => {
    await page.goto(pageURL);
    await page.locator('#status').filter({hasText: 'Browse'}).waitFor({timeout: longOperationMilliseconds});
  });
  for (const filename of measuredModes) {
    result[`${filename} ms`] = await timed(() => openMode(page, filename));
  }
  result.heapMegabytes = await usedHeapMegabytes(page);
  await context.close();
  return result;
}

async function main() {
  const factors = (process.env.FACTORS ?? '1 2 4 8').split(' ').map(Number);
  const server = spawn('python3', [serverTool, '--port', String(port), '--app', 'editor'], {stdio: 'ignore'});
  try {
    await new Promise(resolve => setTimeout(resolve, serverStartMilliseconds));
    const browser = await chromium.launch({args: browserArguments});
    const results = [];
    for (const factor of factors) results.push(await measure(browser, factor));
    await browser.close();
    console.table(results);
  } finally {
    server.kill();
  }
}

await main();
