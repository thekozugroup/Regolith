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
    // `__name__.ts` is this repo's sentinel for a SYNTHETIC file: source that
    // exists only as a string passed to `eslint.lintText` (tests/
    // aiImportFence.test.ts lints one to prove the safety fence still fires).
    // A type-aware config cannot see a file that is not on disk and would
    // report a fatal parse error instead of the rule under test.
    ignores: ['**/__*__.{ts,tsx}'],
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
  {
    // SAFETY FENCE — no AI-derived output may ever reach the printer.
    //
    // Nothing under src/lib/ai/** may import the transport (moonraker) or the
    // action boundary (printerActions), directly or through the hooks that
    // wrap them. AI output is display text and alerts only; a comment is not
    // enforcement, so this is an error and it fails `bun run lint` — which is
    // a required gate — on violation. tests/aiImportFence.test.ts proves the
    // rule actually fires, and walks the transitive import graph as well.
    files: ['src/lib/ai/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/moonraker',
                '**/moonraker.ts',
                '**/printerActions',
                '**/printerActions.ts',
                '**/usePrinter',
                '**/usePrinter.ts',
                '**/telltales',
                '**/telltales.ts',
                '**/safety',
                '**/safety.ts',
              ],
              message:
                'src/lib/ai/** may never reach the printer: no moonraker, printerActions, usePrinter, telltales or safety imports. AI output is display text and alerts only.',
            },
          ],
        },
      ],
    },
  },
])
