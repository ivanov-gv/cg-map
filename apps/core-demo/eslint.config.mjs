import globals from 'globals';
import {appFunctionRules, appReadabilityRules, commonRules, recommended} from '../../platform/eslint-rules.mjs';

const nodeAndBrowserGlobals = {...globals.node, ...globals.browser};
const runtimeFiles = ['src/**/*.js'];
// Root parity: Node globals belong to .mjs tools; the function budget belongs to both tool extensions.
const nodeToolFiles = ['tools/**/*.mjs'];
const toolFiles = [...nodeToolFiles, 'tools/**/*.js'];
const sourceTestFiles = ['src/**/*.test.js'];
const browserTestFiles = ['src/**/*.browser.test.js'];
const unitTestFiles = ['src/**/!(*.browser).test.js'];
const nodeFiles = [...nodeToolFiles, 'e2e/**/*.js', 'tests/**/*.mjs', ...unitTestFiles, '*.mjs'];

export default [
  {ignores: ['node_modules/**', 'dist/**', '.build/**']},
  recommended,
  {
    files: runtimeFiles,
    languageOptions: {globals: {...globals.browser, maplibregl: 'readonly', pmtiles: 'readonly'}}
  },
  {files: nodeFiles, languageOptions: {globals: nodeAndBrowserGlobals}},
  {files: browserTestFiles, languageOptions: {globals: nodeAndBrowserGlobals}},
  {files: ['**/*.js', '**/*.mjs'], rules: commonRules},
  {files: ['**/*.js', '**/*.mjs'], rules: appReadabilityRules},
  {files: [...runtimeFiles, ...toolFiles], rules: appFunctionRules},
  {files: [...sourceTestFiles, ...browserTestFiles], rules: {'max-lines-per-function': 'off'}}
];
