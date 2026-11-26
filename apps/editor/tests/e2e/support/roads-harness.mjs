// Installs the roads harness on a page served from the editor's own origin, then mounts only its components. The
// page never loads app.js: Playwright supplies the document and the harness module, and the editor serves its modules.
import {readFile} from 'node:fs/promises';
import {collectionOf} from '../../../src/source-data/source-records.js';
import {fixtureBundle} from '../fixture-city.mjs';
import rules from '../../fixtures/editor-layers.json' with {type: 'json'};

const harnessPageName = 'roads-harness.html';
const harnessModuleName = 'roads-harness-browser.mjs';

function sourcesFromFixture() {
  const {files, manifest} = fixtureBundle();
  return manifest.layers.map(({filename, sha256, bytes, featureCount}) => [
    filename,
    {metadata: {filename, sha256, bytes, featureCount}, collection: collectionOf(filename, JSON.parse(files.get(filename)))}
  ]);
}

function harnessDocument(baseURL, moduleURL) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="${baseURL}vendor/maplibre-gl.css">
  <style>
    /* The production stylesheet makes hidden win over layout; mirror it here so hidden overlays cannot catch clicks. */
    [hidden] { display: none !important; }
    html, body { margin: 0; width: 1280px; height: 800px; }
    #harness-map { position: absolute; inset: 0; }
    #editor, #mode-bar, #level-picker { position: absolute; z-index: 2; }
    /* The actions belong to the inspector, as in the app, so they cannot cover its Close button. */
    #editor { top: 8px; left: 8px; width: 320px; max-height: 70vh; overflow: auto; background: #fffffb; }
    #mode-bar { bottom: 8px; left: 8px; }
    #level-picker { top: 8px; left: 360px; display: flex; flex-direction: column; }
    #tool-buttons { position: absolute; z-index: 3; top: 8px; right: 8px; }
    #toast {
      position: absolute; z-index: 4; bottom: 24px; left: 50%; transform: translateX(-50%);
      display: flex; align-items: center; gap: 12px; padding: 6px 6px 6px 16px;
      background: #00695c; color: white; border-radius: 12px;
    }
    #toast button { background: transparent; color: white; border: 0; font-weight: 700; }
  </style>
  <script src="${baseURL}vendor/maplibre-gl.js"></script>
</head>
<body>
  <div id="harness-map"></div>
  <div id="status">Loading Roads…</div>
  <div id="editor" class="inspector" hidden>
    <button id="close-inspector">Close</button>
    <form id="property-form"></form>
    <div id="inspector-extras"></div>
    <div id="edit-actions" hidden>
      <div id="edit-problem" hidden></div>
      <button id="apply-edit" type="submit" form="property-form">Apply</button>
      <button id="cancel-edit">Cancel</button>
    </div>
  </div>
  <div id="mode-bar" hidden>
    <span id="mode-title"></span><span id="mode-hint"></span><span id="mode-notice" hidden></span>
    <span id="mode-buttons"></span>
  </div>
  <div id="level-picker" hidden></div>
  <div id="edit-facts"></div>
  <div id="selection-kind"></div><div id="selection-title"></div>
  <div id="change-count" hidden></div>
  <div id="map-cross" hidden></div>
  <div id="tool-buttons">
    <button id="tool-move">Move</button><button id="tool-vertices">Edit points</button>
    <button id="delete-feature" hidden>Delete</button><button id="leave-note" hidden>Note</button>
  </div>
  <div id="extra-tools"></div>
  <div id="toast" hidden><span id="toast-message"></span><button id="toast-action" hidden></button></div>
  <script type="module">
    import {mountRoadsHarness} from '${moduleURL}';
    window.mountRoadsHarness = mountRoadsHarness;
  </script>
</body>
</html>`;
}

async function installHarness(page, baseURL) {
  const moduleURL = new URL(harnessModuleName, baseURL).href;
  const source = await readFile(new URL('./roads-harness-browser.mjs', import.meta.url), 'utf8');
  await page.route(moduleURL, route => route.fulfill({
    contentType: 'text/javascript',
    body: source.replaceAll('__APP_BASE__', baseURL)
  }));
  const pageURL = new URL(harnessPageName, baseURL).href;
  await page.route(pageURL, route => route.fulfill({
    contentType: 'text/html',
    body: harnessDocument(baseURL, moduleURL)
  }));
  await page.goto(pageURL);
  await page.waitForFunction(() => typeof window.mountRoadsHarness === 'function');
}

async function mountComponents(page, baseURL) {
  await page.evaluate(
    ({sourceEntries, rulesConfig, appBase}) => window.mountRoadsHarness({sourceEntries, rulesConfig, appBase}),
    {sourceEntries: sourcesFromFixture(), rulesConfig: rules, appBase: baseURL}
  );
}

// One place for every roads browser test: app modules and the fixture city, but no app.js and no side panel.
export async function openRoadsHarness(page, appBase) {
  const baseURL = appBase.endsWith('/') ? appBase : `${appBase}/`;
  await installHarness(page, baseURL);
  return mountComponents(page, baseURL);
}
