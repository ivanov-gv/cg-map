import {test, expect} from '@playwright/test';
import {createHash} from 'node:crypto';
import fileSystem from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// Each test runs against its own server, so that it can publish a new release or disappear altogether.
const artifactDirectory = fileURLToPath(new URL('../../../../dist/editor/', import.meta.url));
const contentTypes = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.geojson': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp'
};
const readyMessage = 'Saved on this device. Works offline.';

// overrides maps a path to the bytes a release serves there instead of the built file. requests records every read.
function startReleaseServer(pathPrefix = '/') {
  const state = {overrides: new Map(), requests: [], heldPaths: new Map()};
  const server = http.createServer(async (request, response) => {
    const requestPathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const requestPath = requestPathname.slice(pathPrefix.length) || 'index.html';
    state.requests.push({path: requestPath, range: request.headers.range});
    if (state.heldPaths.has(requestPath)) await state.heldPaths.get(requestPath);
    const filePath = path.join(artifactDirectory, requestPath);
    const isServable = state.overrides.has(requestPath) || (fileSystem.existsSync(filePath) && fileSystem.statSync(filePath).isFile());
    if (!isServable) {
      response.writeHead(404).end();
      return;
    }
    const bytes = state.overrides.get(requestPath) ?? fileSystem.readFileSync(filePath);
    const headers = {'Content-Type': contentTypes[path.extname(requestPath)] ?? 'application/octet-stream'};
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
    if (range) {
      const [first, last] = [Number(range[1]), Math.min(Number(range[2]), bytes.length - 1)];
      headers['Content-Range'] = `bytes ${first}-${last}/${bytes.length}`;
      response.writeHead(206, headers).end(bytes.subarray(first, last + 1));
      return;
    }
    response.writeHead(200, headers).end(bytes);
  });
  const sockets = new Set();
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        ...state,
        url: `http://127.0.0.1:${server.address().port}${pathPrefix}`,
        stop: () =>
          new Promise(closed => {
            for (const socket of sockets) socket.destroy();
            server.close(closed);
          })
      });
    });
  });
}

const readArtifact = file => fileSystem.readFileSync(path.join(artifactDirectory, file));

const sha256Of = bytes => createHash('sha256').update(bytes).digest('hex');

// What a real build changes for a new release: the worker's bytes, the manifest and at least one page file.
function publishNewRelease(server, marker) {
  const previousPage = readArtifact('index.html');
  const page = Buffer.from(previousPage.toString().replace('Layer editor', `Layer editor ${marker}`));
  const manifest = readArtifact('offline-manifest.js')
    .toString()
    .replace(sha256Of(previousPage), sha256Of(page))
    .replace(/release = "[a-f0-9]+"/, `release = "${marker}"`);
  server.overrides.set('offline-manifest.js', Buffer.from(manifest));
  server.overrides.set('sw.js', Buffer.concat([Buffer.from(`// ${marker}\n`), readArtifact('sw.js')]));
  server.overrides.set('index.html', page);
}

// A map release has a new content-named file. Trailing bytes leave a PMTiles archive readable while changing its hash.
function publishNewMap(server, servedArchiveBytes = null) {
  const mapMetadata = readArtifact('data/map.json');
  const previousName = JSON.parse(mapMetadata).archive;
  const archive = Buffer.concat([readArtifact(`data/${previousName}`), Buffer.from('new map release')]);
  const nextName = `montenegro-${sha256Of(archive).slice(0, 16)}.pmtiles`;
  const nextMetadata = Buffer.from(JSON.stringify({archive: nextName}));
  const manifest = server.overrides
    .get('offline-manifest.js')
    .toString()
    .replaceAll(previousName, nextName)
    .replace(sha256Of(readArtifact(`data/${previousName}`)), sha256Of(archive))
    .replace(sha256Of(mapMetadata), sha256Of(nextMetadata));
  server.overrides.set('offline-manifest.js', Buffer.from(manifest));
  server.overrides.set('data/map.json', nextMetadata);
  server.overrides.set(`data/${nextName}`, servedArchiveBytes ?? archive);
}

const editorCaches = page => page.evaluate(() => caches.keys());
const isShellCacheOf = (name, release) => name === `editor-shell-${release}`;

const expectBrowse = page => expect(page.locator('#status')).toHaveText('Browse · all source files locked');

const openUntilOffline = async (page, server) => {
  await page.goto(server.url);
  await expectBrowse(page);
  await expect(page.locator('#offline-status')).toContainText(readyMessage, {timeout: 60000});
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
};

const renderedBasemapFeatures = page => page.evaluate(() => window.editorDebug.map.queryRenderedFeatures().length);

test.describe('offline-first install under a URL prefix', () => {
  test.use({serviceWorkers: 'allow'});

  test('installs and opens offline under a project prefix', {tag: '@phone'}, async ({page}) => {
    const server = await startReleaseServer('/cg-map/');
    try {
      await openUntilOffline(page, server);
      await server.stop();
      await page.reload();
      await expectBrowse(page);
      await expect.poll(() => renderedBasemapFeatures(page)).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });
});

test.describe('offline-first install', () => {
  test.use({serviceWorkers: 'allow'});

  let server;
  test.beforeEach(async () => {
    server = await startReleaseServer();
  });
  test.afterEach(async () => {
    await server.stop();
  });

  test('the editor is installable', {tag: '@phone'}, async ({page, browserName}) => {
    test.skip(browserName !== 'chromium', 'The installability report is a Chromium protocol.');
    await openUntilOffline(page, server);
    const browser = await page.context().newCDPSession(page);
    const {installabilityErrors} = await browser.send('Page.getInstallabilityErrors');
    // Playwright's isolated contexts always report this one. It is about the test browser, not the app.
    const errors = installabilityErrors.map(({errorId}) => errorId).filter(id => id !== 'in-incognito');
    expect(errors).toEqual([]);
    const {url} = await browser.send('Page.getAppManifest');
    expect(url).toBe(`${server.url}manifest.webmanifest`);
  });

  test('with the server gone it still opens, shows the map, edits, saves and exports', async ({page}, testInfo) => {
    await openUntilOffline(page, server);
    await server.stop();
    await page.reload();
    await expectBrowse(page);
    await expect(page.locator('#error')).toBeHidden();
    await expect.poll(() => renderedBasemapFeatures(page)).toBeGreaterThan(0);

    await page.locator('[data-mode="places.geojson"]').click();
    await expect(page.locator('#status')).toContainText('source features · editable');
    await page.locator('#add-feature').click();
    await page.locator('#map').scrollIntoViewIfNeeded();
    const center = await page.evaluate(() => {
      const bounds = window.editorDebug.map.getCanvas().getBoundingClientRect();
      return {x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2};
    });
    await page.mouse.click(center.x, center.y);
    await page.locator('[name="name"]').fill('Added offline');
    await page.locator('[name="category"]').selectOption('food');
    await page.locator('[name="kind"]').fill('cafe');
    await page.locator('[name="visibilityLevel"]').selectOption('4');
    await page.locator('#apply-edit').click();
    await expect(page.locator('#editor')).toBeHidden();

    await page.reload();
    await expect(page.locator('#review-message')).toHaveText('Restored your saved draft.');
    await page.locator('#changeset-author').fill('Offline Test');
    await page.locator('#changeset-reason').fill('Works without a server');
    const downloadPromise = page.waitForEvent('download');
    await page.locator('#export-changeset').click();
    const download = await downloadPromise;
    const savedPath = testInfo.outputPath(download.suggestedFilename());
    await download.saveAs(savedPath);
    const {operations} = JSON.parse(fileSystem.readFileSync(savedPath));
    expect(operations[0].after.properties.name).toBe('Added offline');
  });

  test('a new release waits for a click, then replaces the page without downloading the map again', async ({page}) => {
    await openUntilOffline(page, server);
    publishNewRelease(server, 'second-release');
    server.requests.length = 0;
    await page.reload();
    await expect(page.locator('#update-app')).toBeVisible({timeout: 60000});
    await expect(page.locator('header p')).toHaveText('Layer editor');
    const archiveDownloads = server.requests.filter(
      ({path: filePath, range}) => filePath.endsWith('.pmtiles') && !range
    );
    expect(archiveDownloads).toEqual([]);

    await page.locator('#update-app').click();
    await expect(page.locator('header p')).toHaveText('Layer editor second-release');
    await expect(page.locator('#update-app')).toBeHidden();
    await expectBrowse(page);
    await expect(page.locator('#offline-status')).toContainText(readyMessage);
    await expect.poll(() => renderedBasemapFeatures(page)).toBeGreaterThan(0);

    await server.stop();
    await page.reload();
    await expect(page.locator('header p')).toHaveText('Layer editor second-release');
    await expectBrowse(page);
  });

  test('an open edit blocks the update', async ({page}) => {
    await openUntilOffline(page, server);
    publishNewRelease(server, 'second-release');
    await page.reload();
    await expect(page.locator('#update-app')).toBeVisible({timeout: 60000});
    await page.locator('[data-mode="places.geojson"]').click();
    await expect(page.locator('#status')).toContainText('editable');
    await page.locator('#add-feature').click();
    await expect(page.locator('#update-app')).toBeDisabled();
    await page.locator('#cancel-edit').click();
    await expect(page.locator('#update-app')).toBeEnabled();
  });

  test('a tampered update is refused, and the working copy keeps working offline', async ({page}) => {
    await openUntilOffline(page, server);
    publishNewRelease(server, 'second-release');
    server.overrides.set('app.js', Buffer.from('// tampered'));
    await page.reload();
    await expect(page.locator('#offline-status')).toHaveText('The update failed. This version keeps working.', {
      timeout: 60000
    });
    await expect(page.locator('#update-app')).toBeHidden();
    await server.stop();
    await page.reload();
    await expectBrowse(page);
    await expect(page.locator('header p')).toHaveText('Layer editor');
  });

  test('an update removes the old release, and a new map replaces the old one and works offline', async ({page}) => {
    await openUntilOffline(page, server);
    const [previousArchiveCache] = (await editorCaches(page)).filter(name => name.startsWith('editor-archive-'));
    publishNewRelease(server, 'second-release');
    publishNewMap(server);
    await page.reload();
    await expect(page.locator('#update-app')).toBeVisible({timeout: 60000});
    await page.locator('#update-app').click();
    await expect(page.locator('header p')).toHaveText('Layer editor second-release');
    await expect(page.locator('#offline-status')).toContainText(readyMessage);
    await expect.poll(() => editorCaches(page).then(names => names.length)).toBe(2);
    const cacheNames = await editorCaches(page);
    expect(cacheNames.some(name => isShellCacheOf(name, 'second-release'))).toBe(true);
    expect(cacheNames).not.toContain(previousArchiveCache);

    await server.stop();
    await page.reload();
    await expectBrowse(page);
    await expect.poll(() => renderedBasemapFeatures(page)).toBeGreaterThan(0);
    await expect(page.locator('#error')).toBeHidden();
  });

  test('a corrupt new map is refused, and the old map keeps working offline', async ({page}) => {
    await openUntilOffline(page, server);
    const cachesBefore = await editorCaches(page);
    publishNewRelease(server, 'second-release');
    publishNewMap(server, Buffer.from('corrupt archive'));
    await page.reload();
    await expect(page.locator('#offline-status')).toHaveText('The update failed. This version keeps working.', {
      timeout: 60000
    });
    await expect.poll(() => editorCaches(page).then(names => names.includes(cachesBefore[0]))).toBe(true);
    const cachesAfter = await editorCaches(page);
    for (const name of cachesBefore) expect(cachesAfter).toContain(name);
    expect(cachesAfter.some(name => isShellCacheOf(name, 'second-release'))).toBe(false);
    await server.stop();
    await page.reload();
    await expectBrowse(page);
    await expect.poll(() => renderedBasemapFeatures(page)).toBeGreaterThan(0);
  });

  test('a version activating while a newer one downloads cannot leave a broken offline copy', async ({page}) => {
    await openUntilOffline(page, server);
    publishNewRelease(server, 'second-release');
    await page.reload();
    await expect(page.locator('#update-app')).toBeVisible({timeout: 60000});

    publishNewRelease(server, 'third-release');
    let releaseStyle;
    server.heldPaths.set('style.css', new Promise(resolve => (releaseStyle = resolve)));
    server.requests.length = 0;
    await page.reload();
    await expect(page.locator('#offline-status')).toHaveText('Downloading a new version…', {timeout: 60000});
    await expect(page.locator('#update-app')).toBeHidden();
    await expect.poll(() => server.requests.some(({path: filePath}) => filePath === 'style.css')).toBe(true);

    // Closing every window would do the same as this message: the older waiting version takes over.
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      registration.waiting.postMessage({type: 'activate-update'});
    });
    await expect(page.locator('header p')).toHaveText('Layer editor second-release');
    releaseStyle();
    server.heldPaths.clear();
    await expect(page.locator('#update-app')).toBeVisible({timeout: 60000});
    await page.locator('#update-app').click();
    await expect(page.locator('header p')).toHaveText('Layer editor third-release', {timeout: 30000});
    await expect(page.locator('#offline-status')).toContainText(readyMessage);
    await expect.poll(() => editorCaches(page).then(names => names.length)).toBe(2);

    await server.stop();
    await page.reload();
    await expect(page.locator('header p')).toHaveText('Layer editor third-release');
    await expectBrowse(page);
  });

  test('a failed reinstall of the build in use keeps that build', async ({page}) => {
    await openUntilOffline(page, server);
    publishNewRelease(server, 'second-release');
    await page.reload();
    await expect(page.locator('#update-app')).toBeVisible({timeout: 60000});
    // Going back to the first build gives it the same cache name as the one in use, and this copy of it is bad.
    server.overrides.clear();
    server.overrides.set('style.css', Buffer.from('/* interrupted */'));
    await page.reload();
    await expect(page.locator('#offline-status')).toHaveText(
      'A new version is ready. A newer one failed to download.',
      {
        timeout: 60000
      }
    );
    await expect(page.locator('#update-app')).toBeVisible();
    await server.stop();
    await page.reload();
    await expect(page.locator('header p')).toHaveText('Layer editor');
    await expectBrowse(page);
  });

  test('every window reloads on an update, except one holding an open edit', async ({page, context}) => {
    await openUntilOffline(page, server);
    const quietWindow = await context.newPage();
    const busyWindow = await context.newPage();
    for (const editorWindow of [quietWindow, busyWindow]) {
      await editorWindow.goto(server.url);
      await expectBrowse(editorWindow);
    }
    await busyWindow.locator('[data-mode="places.geojson"]').click();
    await expect(busyWindow.locator('#status')).toContainText('editable');
    await busyWindow.locator('#add-feature').click();
    await busyWindow.locator('[name="name"]').fill('Still typing');

    publishNewRelease(server, 'second-release');
    await page.reload();
    await expect(page.locator('#update-app')).toBeVisible({timeout: 60000});
    await page.locator('#update-app').click();
    await expect(page.locator('header p')).toHaveText('Layer editor second-release', {timeout: 30000});
    await expect(quietWindow.locator('header p')).toHaveText('Layer editor second-release');
    await expect(busyWindow.locator('#offline-status')).toContainText('Finish and save your work, then reload.');
    await expect(busyWindow.locator('[name="name"]')).toHaveValue('Still typing');
  });

  test('edits that could not be saved block the update', async ({page}) => {
    await page.addInitScript(() => {
      const realSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (window.isStorageFull) throw new Error('quota exceeded');
        return realSetItem.call(this, key, value);
      };
    });
    await openUntilOffline(page, server);
    publishNewRelease(server, 'second-release');
    await page.reload();
    await expect(page.locator('#update-app')).toBeVisible({timeout: 60000});
    await page.locator('[data-mode="places.geojson"]').click();
    await expect(page.locator('#status')).toContainText('editable');
    await page.evaluate(() => {
      window.isStorageFull = true;
    });
    await page.locator('#add-feature').click();
    await page.locator('#map').scrollIntoViewIfNeeded();
    const center = await page.evaluate(() => {
      const bounds = window.editorDebug.map.getCanvas().getBoundingClientRect();
      return {x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2};
    });
    await page.mouse.click(center.x, center.y);
    await page.locator('[name="name"]').fill('Only in memory');
    await page.locator('[name="category"]').selectOption('food');
    await page.locator('[name="kind"]').fill('cafe');
    await page.locator('[name="visibilityLevel"]').selectOption('4');
    await page.locator('#apply-edit').click();
    await expect(page.locator('#error')).toContainText('Draft not saved');
    await expect(page.locator('#update-app')).toBeDisabled();
    await expect(page.locator('#update-hint')).toBeVisible();

    await page.evaluate(() => {
      window.isStorageFull = false;
    });
    await page.locator('#undo').click();
    await expect(page.locator('#update-app')).toBeEnabled();
  });

  test('a failed first save says so, and the editor still opens', async ({page}) => {
    server.overrides.set('style.css', Buffer.from('/* tampered */'));
    await page.goto(server.url);
    await expectBrowse(page);
    await expect(page.locator('#offline-status')).toHaveText(
      'Could not save the editor for offline use. Reload to try again.',
      {timeout: 60000}
    );
    await expect(page.locator('#offline-status')).toHaveAttribute('role', 'alert');
  });
});
