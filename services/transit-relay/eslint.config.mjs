import globals from 'globals';
import {commonRules, recommended} from '../../platform/eslint-rules.mjs';

export default [
  {ignores: ['node_modules/**', 'dist/**', '.build/**']},
  recommended,
  {files: ['*.mjs', 'tests/**/*.mjs'], languageOptions: {globals: {...globals.node, ...globals.browser}}},
  {files: ['**/*.js', '**/*.mjs'], rules: commonRules}
];
