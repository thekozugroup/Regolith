import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    // React Compiler-only rules are not enabled for this Vite app. Several
    // components intentionally bootstrap async subscriptions from effects.
    rules: {
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
    },
  },
  {
    // FLOATING PROMISES — a rejection nobody handles does not crash the app,
    // which is exactly why it is dangerous here: the spinner keeps turning,
    // the control keeps looking armed, and the owner reads a screen that is
    // no longer describing the machine. This rule needs type information, so
    // it is scoped to src/** rather than paid for across the whole repo.
    //
    // The fix is always a `.catch` at the call site. `void` is permitted only
    // where the callee settles its own failure into state — the loaders in
    // pages/*, which already render their own error line.
    files: ['src/**/*.{ts,tsx}'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
])
