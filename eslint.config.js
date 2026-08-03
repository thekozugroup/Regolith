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
