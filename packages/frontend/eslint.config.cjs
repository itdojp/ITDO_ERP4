const js = require('@eslint/js');
const tsParser = require('@typescript-eslint/parser');
const tsPlugin = require('@typescript-eslint/eslint-plugin');
const react = require('eslint-plugin-react');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = [
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        RequestInit: 'readonly',
        HTMLElement: 'readonly'
      }
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      react,
      'react-hooks': reactHooks
    },
    settings: {
      react: { version: 'detect' }
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tsPlugin.configs.recommended.rules,
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  }
];
