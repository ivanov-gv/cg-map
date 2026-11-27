import globals from 'globals';
import {appFunctionRules, appReadabilityRules, commonRules, recommended} from '../../platform/eslint-rules.mjs';

// Runtime sees the same browser globals as the other apps, plus the vendored map globals.
const browserGlobals = {...globals.browser, maplibregl: 'readonly', pmtiles: 'readonly'};
const nodeAndBrowserGlobals = {...globals.node, ...globals.browser};

const nodeFiles = [
  'src/**/*.test.js',
  'tools/**/*.mjs',
  'tools/**/*.js',
  'tests/**/*.mjs',
  'tests/**/*.js',
  'e2e/**/*.js',
  'playwright.config.mjs',
  'eslint.config.mjs'
];

// The 80-line backstop covers production and tools; colocated tests keep their linear scenarios intact.
const functionBudgetFiles = ['src/**/*.js', 'tools/**/*.mjs', 'tools/**/*.js'];
const functionBudgetIgnores = ['src/**/*.test.js', 'tools/**/*.test.js'];

export default [
  {ignores: ['node_modules/**', 'dist/**', '.build/**']},
  recommended,
  {files: ['src/**/*.js'], languageOptions: {globals: browserGlobals}},
  {files: ['src/sw.js'], languageOptions: {globals: {...browserGlobals, ...globals.serviceworker}}},
  {files: nodeFiles, languageOptions: {globals: nodeAndBrowserGlobals}},
  {files: ['**/*.js', '**/*.mjs'], rules: {...commonRules, ...appReadabilityRules}},
  {files: functionBudgetFiles, ignores: functionBudgetIgnores, rules: appFunctionRules}
];
