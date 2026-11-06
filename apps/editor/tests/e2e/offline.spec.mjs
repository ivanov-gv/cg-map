import {test, expect} from '@playwright/test';
import fs from 'node:fs';
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
function startReleaseServer() {
  const state = {overrides: new Map(), requests: []};
  const server = http.createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname.slice(1)) || 'index.html';
    state.requests.push({path: requestPath, range: request.headers.range});
    const filePath = path.join(artifactDirectory, requestPath);
    const isServable = state.overrides.has(requestPath) || (fs.existsSync(filePath) && fs.statSync(filePath).isFile());
    if (!isServable) {
      response.writeHead(404).end();
      return;
    }
    const bytes = state.overrides.get(requestPath) ?? fs.readFileSync(filePath);
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
        url: `http://127.0.0.1:${server.address().port}/`,
        stop: () =>
          new Promise(closed => {
            for (const socket of sockets) socket.destroy();
            server.close(closed);
          })
      });
    });
  });
}

const readArtifact = file => fs.readFileSync(path.join(artifactDirectory, file));

// What a real build changes for a new release: the worker's bytes, the manifest and at least one page file.
function publishNewRelease(server, marker) {
  const manifest = readArtifact('offline-manifest.js').toString();
  const page = Buffer.from(readArtifact('index.html').toString().replace('Layer editor', `Layer editor ${marker}`));
  const pageHash = crypto.subtle.digest('SHA-256', page);
  return pageHash.then(digest => {
    const hash = Buffer.from(digest).toString('hex');
    const previousHash = /"path":"index\.html","sha256":"([a-f0-9]{64})"/.exec(manifest)[1];
    const nextManifest = manifest.replace(previousHash, hash).replace(/release = "[a-f0-9]+"/, `release = "${marker}"`);
    server.overrides.set('offline-manifest.js', Buffer.from(nextManifest));
    server.overrides.set('sw.js', Buffer.concat([Buffer.from(`// ${marker}\n`), readArtifact('sw.js')]));
    server.overrides.set('index.html', page);
  });
}

const expectBrowse = page => expect(page.locator('#status')).toHaveText('Browse · all source files locked');

const openUntilOffline = async (page, server) => {
  await page.goto(server.url);
  await expectBrowse(page);
  await expect(page.locator('#offline-status')).toHaveText(readyMessage, {timeout: 60000});
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
};

const renderedBasemapFeatures = page => page.evaluate(() => window.editorDebug.map.queryRenderedFeatures().length);

test.describe('offline-first install', () => {
  test.use({serviceWorkers: 'allow'});

  let server;
  test.beforeEach(async () => {
    server = await startReleaseServer();
  });
  test.afterEach(async () => {
    await server.stop();
  });

  test('the editor is installable', async ({page, browserName}) => {
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
    const {operations} = JSON.parse(fs.readFileSync(savedPath));
    expect(operations[0].after.properties.name).toBe('Added offline');
  });

  test('a new release waits for a click, then replaces the page without downloading the map again', async ({page}) => {
    await openUntilOffline(page, server);
    await publishNewRelease(server, 'second-release');
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
    await expect(page.locator('#offline-status')).toHaveText(readyMessage);
    await expect.poll(() => renderedBasemapFeatures(page)).toBeGreaterThan(0);

    await server.stop();
    await page.reload();
    await expect(page.locator('header p')).toHaveText('Layer editor second-release');
    await expectBrowse(page);
  });

  test('an open edit blocks the update', async ({page}) => {
    await openUntilOffline(page, server);
    await publishNewRelease(server, 'second-release');
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
    await publishNewRelease(server, 'second-release');
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
