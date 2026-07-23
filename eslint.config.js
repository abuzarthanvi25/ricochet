import js from '@eslint/js'
import globals from 'globals'
import prettier from 'eslint-config-prettier'

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'assets/**'],
  },

  js.configs.recommended,

  // Game source: browser environment.
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      // Scratch vectors and intentionally-unused params are named with a
      // leading underscore throughout this codebase.
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'none',
        },
      ],

      // Per-frame code must not allocate or leak globals.
      'no-implicit-globals': 'error',
      'no-var': 'error',
      'prefer-const': 'error',

      // Empty catch blocks are used deliberately (localStorage in private mode,
      // pointer lock rejection); require a comment rather than banning them.
      'no-empty': ['error', { allowEmptyCatch: true }],

      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // Dev tooling ships to the browser too but may log freely.
  {
    files: ['src/dev/**/*.js'],
    rules: {
      'no-console': 'off',
    },
  },

  // Tests and build config: Node environment.
  {
    files: ['test/**/*.mjs', 'vite.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'off',
    },
  },

  // Must stay last: turns off every rule that would fight Prettier.
  prettier,
]
