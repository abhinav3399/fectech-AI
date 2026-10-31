import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Generated Android/Gradle output and built web assets are not source.
  globalIgnores(['dist', 'android', 'node_modules', 'coverage']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { react },
    settings: { react: { version: 'detect' } },
    rules: {
      // Without this, JSX member usage like <motion.div> is reported as an unused
      // `motion` import, which produces dozens of false positives.
      'react/jsx-uses-vars': 'error',
      // `catch (e) { /* best effort */ }` is an intentional pattern throughout the
      // app; unused error bindings are not defects.
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        caughtErrors: 'none',
        argsIgnorePattern: '^_',
      }],
    },
  },
  {
    // Feedback intentionally exports event helpers (toast/confirmAction) next to
    // the host component; this is an API surface, not a fast-refresh accident.
    files: ['src/components/Feedback.jsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
])
