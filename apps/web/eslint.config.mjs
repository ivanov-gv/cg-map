import globals from 'globals';
import {
  appFunctionRules,
  appReadabilityRules,
  commonRules,
  pureModuleRules,
  recommended,
  webRuntimeImportRules
} from '../../platform/eslint-rules.mjs';

const runtimeFiles = ['src/**/*.js'];
const sourceTestFiles = ['src/**/*.test.js'];
const toolFiles = ['tools/**/*.js', 'tools/**/*.mjs'];
const nodeFiles = [...toolFiles, ...sourceTestFiles, 'tests/**/*.js', 'tests/**/*.mjs', '*.mjs'];
// Root parity: the service worker keeps its own globals and a script source type.
const serviceWorkerFile = 'src/sw.js';
// Root parity: these modules stay free of browser, storage and network globals.
const pureModules = ['src/core.js', 'src/data-mode.js', 'src/status-messages.js', 'src/vehicle-direction.js'];
// ADR 0043: a long linear test scenario does not need the production function budget.
const testFiles = [...sourceTestFiles, 'tests/**/*.test.js'];

export default [
  {ignores: ['node_modules/**', 'dist/**', '.build/**']},
  recommended,
  {files: runtimeFiles, languageOptions: {globals: {...globals.browser, maplibregl: 'readonly', pmtiles: 'readonly'}}},
  {files: [serviceWorkerFile], languageOptions: {sourceType: 'script', globals: globals.serviceworker}},
  {files: nodeFiles, languageOptions: {globals: {...globals.node, ...globals.browser}}},
  {files: ['**/*.js', '**/*.mjs'], rules: {...commonRules, ...appReadabilityRules}},
  {files: [...runtimeFiles, ...toolFiles], rules: appFunctionRules},
  {files: runtimeFiles, rules: webRuntimeImportRules},
  {files: pureModules, rules: pureModuleRules},
  {files: testFiles, rules: {'max-lines-per-function': 'off'}}
];
