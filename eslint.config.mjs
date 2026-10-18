import js from '@eslint/js';
import globals from 'globals';
const nodeFiles = ['apps/web/tools/*.mjs', 'apps/web/tests/*.mjs', 'data/**/*.mjs', 'platform/**/*.mjs', 'tests/**/*.mjs', '*.mjs'];
export default [
  {ignores: ['node_modules/**', 'dist/**', '.build/**', 'apps/web/public/vendor/**']},
  js.configs.recommended,
  {files: ['apps/web/src/*.js'], languageOptions: {globals: {...globals.browser, maplibregl: 'readonly', pmtiles: 'readonly'}}},
  {files: ['apps/web/src/sw.js', 'platform/pages/legacy-sw.js'], languageOptions: {sourceType: 'script', globals: globals.serviceworker}},
  {files: nodeFiles, languageOptions: {globals: {...globals.node, ...globals.browser}}},
  {files: ['**/*.js', '**/*.mjs'], rules: {'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}], 'no-constant-binary-expression': 'error'}},
  {files: ['apps/web/src/*.js'], rules: {'no-restricted-imports': ['error', {patterns: [{group: ['node:*', '**/data/tools/**', '**/services/**', '**/platform/**', '**/tests/**'], message: 'Web runtime must consume contracts and published assets, not server or pipeline code.'}]}]}},
  {files: ['apps/web/src/core.js'], rules: {'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'location', 'fetch', 'localStorage', 'sessionStorage', 'caches', 'indexedDB']}}
];
