const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');

const maxLinesOptions = (max) => ({
  max,
  skipBlankLines: true,
  skipComments: false,
});

const existingRouteLineAllowances = [
  ['src/routes/auth.ts', 2500],
  ['src/routes/chatRooms.ts', 3150],
  ['src/routes/projects.ts', 2100],
  ['src/routes/chat.ts', 1750],
  ['src/routes/vendorDocs.ts', 1700],
  ['src/routes/reportSubscriptions.ts', 1600],
];

module.exports = [
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
      globals: {
        process: 'readonly',
        console: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-undef': 'off',
      'max-lines': ['error', maxLinesOptions(1500)],
    },
  },
  ...existingRouteLineAllowances.map(([file, max]) => ({
    files: [file],
    rules: {
      'max-lines': ['error', maxLinesOptions(max)],
    },
  })),
];
