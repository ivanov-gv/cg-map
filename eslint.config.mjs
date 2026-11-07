import js from '@eslint/js';
import globals from 'globals';
const nodeFiles = ['packages/contracts/tests/*.mjs', 'packages/map-core/tools/*.mjs', 'packages/map-core/tests/*.mjs', 'apps/core-demo/tools/*.mjs', 'apps/core-demo/tests/**/*.mjs', 'apps/core-demo/*.mjs', 'apps/editor/tools/*.mjs', 'apps/editor/tests/**/*.mjs', 'apps/editor/*.mjs', 'apps/web/tools/*.mjs', 'apps/web/tests/**/*.mjs', 'apps/web/*.mjs', 'data/**/*.mjs', 'services/transit-relay/*.mjs', 'services/transit-relay/tests/**/*.mjs', 'platform/**/*.mjs', 'tests/**/*.mjs', '*.mjs'];
export default [
  {ignores: ['node_modules/**', 'dist/**', '.build/**', 'packages/map-core/assets/vendor/**']},
  js.configs.recommended,
  {files: ['apps/web/src/*.js', 'apps/core-demo/src/*.js', 'apps/editor/src/*.js', 'packages/map-core/src/*.js'], languageOptions: {globals: {...globals.browser, maplibregl: 'readonly', pmtiles: 'readonly'}}},
  {files: ['apps/web/src/sw.js'], languageOptions: {sourceType: 'script', globals: globals.serviceworker}},
  {files: nodeFiles, languageOptions: {globals: {...globals.node, ...globals.browser}}},
  {files: ['**/*.js', '**/*.mjs'], rules: {'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}], 'no-constant-binary-expression': 'error'}},
  {files: ['apps/web/src/*.js'], rules: {'no-restricted-imports': ['error', {patterns: [{group: ['node:*', '**/data/tools/**', '**/services/**', '**/platform/**', '**/tests/**'], message: 'Web runtime must consume contracts and published assets, not server or pipeline code.'}]}]}},
  {files: ['apps/web/src/core.js', 'apps/web/src/status-messages.js', 'apps/web/src/vehicle-direction.js', 'apps/web/src/data-mode.js'], rules: {'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'location', 'fetch', 'localStorage', 'sessionStorage', 'caches', 'indexedDB']}}
];
