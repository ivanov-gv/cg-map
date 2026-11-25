import globals from 'globals';
import {appFunctionRules, appReadabilityRules, commonRules, recommended} from '../../platform/eslint-rules.mjs';

export default [
  {ignores: ['node_modules/**', 'dist/**', '.build/**']},
  recommended,
  {files: ['src/*.js'], languageOptions: {globals: {...globals.browser, maplibregl: 'readonly', pmtiles: 'readonly'}}},
  {files: ['tools/*.mjs', 'tests/**/*.mjs', '*.mjs'], languageOptions: {globals: {...globals.node, ...globals.browser}}},
  {files: ['**/*.js', '**/*.mjs'], rules: commonRules},
  {files: ['**/*.js', '**/*.mjs'], rules: appReadabilityRules},
  {files: ['src/**/*.js', 'tools/**/*.mjs', 'tools/**/*.js'], rules: appFunctionRules}
];
