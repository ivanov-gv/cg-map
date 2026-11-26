import js from '@eslint/js';

// One home for ESLint rules. It holds no project paths: each component's eslint.config.mjs owns its patterns and globals.
export const recommended = js.configs.recommended;

export const commonRules = {
  'no-unused-vars': ['error', {argsIgnorePattern: '^_', caughtErrors: 'none'}],
  'no-constant-binary-expression': 'error'
};

// Mechanical part of docs/engineering/readability.md enforced in apps/.
export const appReadabilityRules = {
  'max-statements-per-line': ['error', {max: 1}],
  'id-length': ['error', {min: 2, properties: 'never', exceptions: ['x', 'y', 'z', 't', '_']}],
  'max-depth': ['error', 3]
};

// The aim stays about 60 lines per function; 80 is the backstop, because declarative layer and style tables count.
export const appFunctionRules = {
  'max-lines-per-function': ['error', {max: 80, skipBlankLines: true, skipComments: true}]
};

export const webRuntimeImportRules = {
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['node:*', '**/data/tools/**', '**/services/**', '**/platform/**', '**/tests/**'],
          message: 'Web runtime must consume contracts and published assets, not server or pipeline code.'
        }
      ]
    }
  ]
};

export const pureModuleRules = {
  'no-restricted-globals': [
    'error',
    'window',
    'document',
    'navigator',
    'location',
    'fetch',
    'localStorage',
    'sessionStorage',
    'caches',
    'indexedDB'
  ]
};
