import globals from 'globals';
import {commonRules, recommended} from '../../platform/eslint-rules.mjs';

export default [
  {ignores: ['node_modules/**', 'dist/**', '.build/**', 'assets/vendor/**']},
  recommended,
  {files: ['src/*.js'], languageOptions: {globals: {...globals.browser, maplibregl: 'readonly', pmtiles: 'readonly'}}},
  {files: ['tools/*.mjs', 'tests/*.mjs', '*.mjs'], languageOptions: {globals: {...globals.node, ...globals.browser}}},
  {files: ['**/*.js', '**/*.mjs'], rules: commonRules}
];
