import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**', '**/playwright-report/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/api/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // A forgotten ownership scope fails CI (schema.md §3).
    files: ['apps/api/src/modules/**/*.ts'],
    ignores: ['apps/api/src/modules/**/scope.ts', 'apps/api/src/modules/admin/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.object.name=/^(Event|Booking|Ticket)$/][callee.property.name='findById']",
          message: 'Use a scoped finder (findOwnedEvent / findMyBooking / findMyTicket).',
        },
      ],
    },
  },
);
