import { defineConfig } from "@playwright/test";
import {
  PREVIEW_HOST,
  PREVIEW_ORIGIN,
  PREVIEW_PORT,
} from "./e2e/support/preview-origin";

// Host and port come from e2e/support/preview-origin.ts — the same module the
// specs' request allowlists read, so the server and the allowlists can never
// disagree. Override with REGOLITH_E2E_PORT when runs overlap.
export default defineConfig({
  testDir: "./e2e",
  // Guard 2. Runs after the last test and fails the run when anything
  // reached the preview server on a printer namespace, or when the harness
  // had to refuse an unmocked one. See e2e/support/assert-no-egress.ts.
  globalTeardown: "./e2e/support/assert-no-egress.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  use: {
    baseURL: PREVIEW_ORIGIN,
    browserName: "chromium",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `bun run preview --host ${PREVIEW_HOST} --port ${PREVIEW_PORT}`,
    url: PREVIEW_ORIGIN,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
