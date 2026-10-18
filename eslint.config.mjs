import js from '@eslint/js';
import globals from 'globals';

export default [
  {ignores: ['node_modules/**', 'dist/**', '.build/**', 'vendor/**', 'data/**', 'fonts/**']},
  js.configs.recommended,
  {files: ['web/*.js'], languageOptions: {globals: {...globals.browser, maplibregl: 'readonly', pmtiles: 'readonly'}}},
  {files: ['web/sw.js', 'web/offline-manifest.js', 'sw.js'], languageOptions: {sourceType: 'script', globals: globals.serviceworker}},
  {files: ['tools/*.mjs', 'tests/**/*.mjs', '*.mjs'], languageOptions: {globals: {...globals.node, ...globals.browser}}},
  {files: ['web/vendor/**'], ignores: ['**/*']},
  {files: ['web/*.js', 'tools/*.mjs', 'tests/**/*.mjs'], rules: {
    'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}],
    'no-constant-binary-expression': 'error',
    'no-restricted-imports': ['error', {patterns: [{group: ['../source-data/*', '../tools/*', '../tests/*', 'node:*'], message: 'Browser runtime must not depend on build tools, tests, or raw source data.'}]}]
  }},
  {files: ['web/core.js'], rules: {'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'location', 'fetch', 'localStorage', 'sessionStorage', 'caches', 'indexedDB']}},
  {files: ['tools/*.mjs', 'tests/**/*.mjs'], rules: {'no-restricted-imports': 'off'}},
  {ignores: ['web/vendor/**']}
];
