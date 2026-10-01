import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.browser', 'generated']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // The app predates the newer React compiler lint rules and intentionally
      // performs a few state synchronizations in effects. Keep lint focused on
      // actionable syntax/runtime issues while the legacy screens migrate.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
    },
  },
  {
    files: ['server/**/*.js', 'api/**/*.js'],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['server/**/*.js', 'api/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
  {
    files: ['scripts/**/*.js', 'config/**/*.js', 'builder/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
