// Installs the places harness on a page served from the editor's own origin. The page never loads app.js: Playwright
// supplies the document and this module mounts only the places component on a small map, with buildings around it so a
// place can say which one it is in.
import {readFile} from 'node:fs/promises';
import {collectionOf} from '../../../src/source-data/source-records.js';
import {fixtureBundle} from '../fixture-city.mjs';
import rules from '../../fixtures/editor-layers.json' with {type: 'json'};

const harnessPageName = 'places-harness.html';
const harnessModuleName = 'places-harness-browser.mjs';

function sourcesOfFixture() {
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
    #editor, #mode-bar, #tools-toggle, #tools-panel { position: absolute; z-index: 2; }
    /* The actions belong to the inspector, as in the app, so they cannot cover its Close button. */
    #editor { top: 8px; left: 8px; width: 320px; max-height: 70vh; overflow: auto; background: #fffffb; }
    #mode-bar { bottom: 8px; left: 8px; }
    #tools-panel { top: 8px; left: 360px; padding: 8px; background: #fffffb; }
    #tool-buttons { position: absolute; z-index: 3; top: 8px; right: 8px; }
    #delete-dialog, #hours-dialog { border: 1px solid #555; background: #fffffb; }
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
  <div id="status">Loading Places…</div>
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
  <button id="tools-toggle" aria-expanded="false" aria-controls="tools-panel">Tools</button>
  <div id="tools-panel" hidden><div id="draw-choices"></div></div>
  <div id="edit-facts"></div>
  <div id="selection-kind"></div><div id="selection-title"></div>
  <div id="change-count" hidden></div>
  <div id="map-cross" hidden></div>
  <div id="tool-buttons">
    <button id="tool-move">Move</button><button id="tool-vertices">Edit corners</button>
    <button id="delete-feature" hidden>Delete</button><button id="leave-note" hidden>Note</button>
  </div>
  <div id="extra-tools"></div>
  <div id="toast" hidden><span id="toast-message"></span><button id="toast-action" hidden></button></div>
  <dialog id="hours-dialog">
    <h3 id="hours-title">Opening hours</h3>
    <p id="hours-note"></p>
    <div id="hours-presets"></div>
    <div id="hours-groups"></div>
    <button id="hours-add-group" type="button">Add days</button>
    <output id="hours-stored"></output>
    <div>
      <button id="hours-back" type="button">Back</button>
      <button id="hours-clear" type="button">Not recorded</button>
      <button id="hours-done" type="button">Done</button>
    </div>
  </dialog>
  <dialog id="delete-dialog">
    <h3 id="delete-title"></h3><p id="delete-message"></p><div id="delete-options"></div>
    <button id="delete-confirm" type="button">Delete</button><button id="delete-cancel" type="button">Cancel</button>
  </dialog>
  <script>
    const toolsToggle = document.getElementById('tools-toggle');
    toolsToggle.onclick = () => {
      const isOpen = toolsToggle.getAttribute('aria-expanded') !== 'true';
      toolsToggle.setAttribute('aria-expanded', String(isOpen));
      document.getElementById('tools-panel').hidden = !isOpen;
    };
  </script>
  <script type="module">
    import {mountPlacesHarness} from '${moduleURL}';
    window.mountPlacesHarness = mountPlacesHarness;
  </script>
</body>
</html>`;
}

async function installHarness(page, baseURL) {
  const moduleURL = new URL(harnessModuleName, baseURL).href;
  const source = await readFile(new URL('./places-harness-browser.mjs', import.meta.url), 'utf8');
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
  await page.waitForFunction(() => typeof window.mountPlacesHarness === 'function');
}

function appBaseOf(appBase) {
  return appBase.endsWith('/') ? appBase : `${appBase}/`;
}

// One place for every places browser test: app modules and the fixture city, but no app.js and no side panel.
export async function openPlacesHarness(page, appBase) {
  const baseURL = appBaseOf(appBase);
  await installHarness(page, baseURL);
  return mountPlacesHarness(page, baseURL);
}

export async function mountPlacesHarness(page, appBase, draft) {
  await page.evaluate(
    ({sourceEntries, rulesConfig, baseURL, savedDraft}) =>
      window.mountPlacesHarness({sourceEntries, rulesConfig, appBase: baseURL, draft: savedDraft}),
    {sourceEntries: sourcesOfFixture(), rulesConfig: rules, baseURL: appBaseOf(appBase), savedDraft: draft}
  );
}
