// Lint rules (TDD §2.4, §12.4): no `any`, no string-built SQL, module boundaries, React hooks.
// Re-exported by the root eslint.config.js; the packages live here because typescript-eslint needs the
// TypeScript 6 API (`@typescript/typescript6`) while the repo compiles with TypeScript 7.
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'packages/db/migrations/**', 'data/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // SQL is built with the `sql` tag and bound parameters only (TDD §10.6).
      'no-restricted-properties': ['error', { object: 'sql', property: 'raw', message: 'Use bound parameters; sql.raw only for constant identifiers, with a reason.' }],
    },
  },
  {
    // A module reaches another module only through its index (TDD §2.4).
    files: ['packages/modules/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['../*/*', '!../*/index.js', '!../integrations/*'], message: 'Import another module through its index.js.' }] },
      ],
    },
  },
  {
    // Tests read untyped JSON response bodies; `any` stays banned in product code.
    files: ['**/*.test.ts', 'apps/api/src/testing.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    files: ['apps/staff/public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    files: ['apps/staff/src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
