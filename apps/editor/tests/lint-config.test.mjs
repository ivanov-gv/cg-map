import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ESLint} from 'eslint';

// Repeats platform/tests/eslint-readability.test.mjs until the shared probe helper lands (ADR 0043).
const editorRoot = fileURLToPath(new URL('..', import.meta.url));
const productionPath = 'src/layers/roads/readability-probe.js';
const unitTestPath = 'src/layers/roads/road-graph.test.js';
const browserTestPath = 'src/layers/roads/road-graph.browser.test.js';
const longBody = count => Array.from({length: count}, (_, index) => `  total += ${index};`).join('\n');

async function ruleIdsAt(filePath, code) {
  const eslint = new ESLint({cwd: editorRoot});
  const [result] = await eslint.lintText(code, {filePath});
  return result.messages.map(message => message.ruleId);
}

test('the Editor config rejects each documented violation in nested production code', async () => {
  const violations = {
    'max-statements-per-line': 'export const first = 1; export const second = 2;\n',
    'id-length': 'export const q = 1;\n',
    'max-depth':
      'export function deep(a1, a2, a3, a4) {\n  if (a1) { if (a2) { if (a3) { if (a4) return 1; } } }\n  return 0;\n}\n',
    'max-lines-per-function': `export function long() {\n  let total = 0;\n${longBody(85)}\n  return total;\n}\n`
  };
  for (const [ruleId, code] of Object.entries(violations)) {
    assert.ok((await ruleIdsAt(productionPath, code)).includes(ruleId), ruleId);
  }
});

test('the Editor config keeps browser globals and documented test exceptions at colocated paths', async () => {
  const runtimeGlobals = [
    'export const element = document.querySelector(".mode");',
    'export const map = maplibregl.Map;',
    'export const tiles = pmtiles;',
    ''
  ].join('\n');
  assert.deepEqual(await ruleIdsAt(productionPath, runtimeGlobals), []);

  const toolMapGlobal = 'export const engine = maplibregl.Map;\n';
  assert.deepEqual(await ruleIdsAt('tools/x.mjs', toolMapGlobal), ['no-undef']);

  const testGlobals = [
    'export const mode = process.env.E2E_PHONE;',
    'export const element = document.querySelector(".mode");',
    'export const point = {a: 1, б: 2};',
    'export const offset = (x, y, z) => x + y + z;',
    ''
  ].join('\n');
  const longTest = `export function scenario() {\n  let total = 0;\n${longBody(85)}\n  return total;\n}\n`;
  for (const filePath of [unitTestPath, browserTestPath]) {
    assert.deepEqual(await ruleIdsAt(filePath, testGlobals), [], filePath);
    assert.ok(!(await ruleIdsAt(filePath, longTest)).includes('max-lines-per-function'), filePath);
  }
});

test('the Editor lint target covers its config and every source kind', async () => {
  const packageFile = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const patterns = packageFile.scripts.lint.split(' ').slice(1);
  const eslint = new ESLint({cwd: editorRoot});
  const results = await eslint.lintFiles(patterns);
  const linted = new Set(results.map(result => path.relative(editorRoot, result.filePath).split(path.sep).join('/')));
  const required = [
    'eslint.config.mjs',
    'playwright.config.mjs',
    'src/app.js',
    'src/sw.js',
    'src/layers/roads/layer-roads.js',
    'src/layers/buildings/layer-buildings.test.js',
    'tools/build.mjs',
    'tools/browser-matrix.test.js',
    'tests/pinned-data.test.mjs'
  ];
  for (const filePath of required) assert.ok(linted.has(filePath), `${filePath} is not linted by npm run lint`);
});
