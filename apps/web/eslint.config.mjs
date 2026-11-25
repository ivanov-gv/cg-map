import globals from 'globals';
import {
  appFunctionRules,
  appReadabilityRules,
  commonRules,
  pureModuleRules,
  recommended,
  webRuntimeImportRules
} from '../../platform/eslint-rules.mjs';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', '.build/**']
  },
  recommended,
  {
    files: ['src/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
        maplibregl: 'readonly',
        pmtiles: 'readonly'
      }
    }
  },
  {
    files: ['src/sw.js'],
    languageOptions: {
      sourceType: 'script',
      globals: globals.serviceworker
    }
  },
  {
    files: ['tools/*.mjs', 'tests/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      }
    }
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    rules: commonRules
  },
  {
    files: ['src/*.js'],
    rules: webRuntimeImportRules
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    rules: appReadabilityRules
  },
  {
    files: ['src/**/*.js', 'tools/**/*.mjs', 'tools/**/*.js'],
    rules: appFunctionRules
  },
  {
    files: ['src/core.js', 'src/status-messages.js', 'src/vehicle-direction.js', 'src/data-mode.js'],
    rules: pureModuleRules
  }
];
