import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ESLint} from 'eslint';

// Lints samples through the config Web ships, so a removed glob or rule fails even while the checked-in files are clean.
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const eslint = new ESLint({cwd: appRoot});
const nestedRuntime = 'src/features/map-control.js';
const nestedTool = 'tools/nested/inventory.mjs';
const unitTest = 'src/features/place.test.js';
const browserTest = 'src/features/place.browser.test.js';

const longBody = count => Array.from({length: count}, (_, index) => `  total += ${index};`).join('\n');
const longFunction = `export function calculateTotal() {\n  let total = 0;\n${longBody(85)}\n  return total;\n}\n`;

async function ruleIdsAt(filePath, code) {
  const [result] = await eslint.lintText(code, {filePath: path.join(appRoot, filePath)});
  return result.messages.map(message => message.ruleId);
}

test('Web owns a config that its lint command reads', async () => {
  assert.ok(fs.existsSync(path.join(appRoot, 'eslint.config.mjs')), 'Web must own its lint config');
  const packageFile = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
  const firstCommand = packageFile.scripts.lint.split('&&')[0].trim();
  assert.equal(firstCommand, 'eslint .');

  const results = await eslint.lintFiles(firstCommand.split(' ').slice(1));
  const linted = new Set(results.map(result => path.relative(appRoot, result.filePath).split(path.sep).join('/')));
  const required = ['eslint.config.mjs', 'playwright.config.mjs', 'src/app.js', 'src/sw.js', 'tools/build.mjs', 'tests/core.test.mjs'];
  for (const filePath of required) assert.ok(linted.has(filePath), `${filePath} is not linted by npm run lint`);
});

test('nested runtime files keep browser and vendored globals', async () => {
  const code = [
    'export const element = document.querySelector(".mode");',
    'export const map = maplibregl.Map;',
    'export const tiles = pmtiles;',
    ''
  ].join('\n');
  assert.deepEqual(await ruleIdsAt(nestedRuntime, code), []);
});

test('nested runtime files keep import and readability restrictions', async () => {
  const forbiddenImport = 'import fs from "node:fs";\nexport const source = fs;\n';
  assert.ok((await ruleIdsAt(nestedRuntime, forbiddenImport)).includes('no-restricted-imports'));
  assert.ok((await ruleIdsAt(nestedRuntime, 'export const q = 1;\n')).includes('id-length'));
  assert.ok((await ruleIdsAt(nestedRuntime, longFunction)).includes('max-lines-per-function'));
});

test('pure modules still reject browser, storage and network globals', async () => {
  const code = 'export const width = window.innerWidth;\n';
  for (const filePath of ['src/core.js', 'src/data-mode.js', 'src/status-messages.js', 'src/vehicle-direction.js']) {
    assert.ok((await ruleIdsAt(filePath, code)).includes('no-restricted-globals'), filePath);
  }
});

test('the service worker keeps script source type and worker globals', async () => {
  const config = await eslint.calculateConfigForFile(path.join(appRoot, 'src/sw.js'));
  assert.equal(config.languageOptions.sourceType, 'script');
  assert.ok(Object.hasOwn(config.languageOptions.globals, 'caches'));
  assert.deepEqual(await ruleIdsAt('src/sw.js', "self.addEventListener('install', () => caches.keys());\n"), []);
});

test('nested tools keep Node globals and the function budget', async () => {
  assert.deepEqual(await ruleIdsAt(nestedTool, 'export const mode = process.env.NODE_ENV;\n'), []);
  for (const filePath of [nestedTool, 'tools/nested/inventory.js']) {
    assert.ok((await ruleIdsAt(filePath, longFunction)).includes('max-lines-per-function'), filePath);
  }
});

test('colocated tests keep both globals and the long-test exception but not readability violations', async () => {
  const globalsCode = [
    'export const mode = process.env.E2E_PHONE;',
    'export const element = document.querySelector(".mode");',
    ''
  ].join('\n');
  for (const filePath of [unitTest, browserTest]) {
    assert.deepEqual(await ruleIdsAt(filePath, globalsCode), [], filePath);
    assert.deepEqual(await ruleIdsAt(filePath, longFunction), [], filePath);
    assert.ok((await ruleIdsAt(filePath, 'export const q = 1;\n')).includes('id-length'), filePath);
  }
});
