/**
 * Where the e2e preview server lives.
 *
 * The port used to be hard-pinned to 4173 in the Playwright config, in the
 * request allowlists of six specs, and in the active-state harness. That is
 * fine until two runs overlap: the second `vite preview` cannot bind, the
 * suite attaches to whatever is already on 4173, and every request fails
 * ERR_BLOCKED_BY_CLIENT because the allowlist and the actual origin no
 * longer agree. One session lost all 254 tests to exactly that.
 *
 * So the port comes from the environment, with 4173 as the default, and the
 * allowlists derive from the SAME value the server binds to — they cannot
 * drift apart again:
 *
 *   REGOLITH_E2E_PORT=4273 bun run test:e2e
 *
 * Everything else stays blocked. This module widens nothing: it is only the
 * single source of truth for which origin counts as "the app under test".
 */

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = "4173";

export const PREVIEW_HOST = process.env.REGOLITH_E2E_HOST ?? DEFAULT_HOST;
export const PREVIEW_PORT = process.env.REGOLITH_E2E_PORT ?? DEFAULT_PORT;
export const PREVIEW_ORIGIN = `http://${PREVIEW_HOST}:${PREVIEW_PORT}`;

/** True when a URL belongs to the app under test (and so may be served). */
export function isPreviewUrl(url: URL): boolean {
  return url.hostname === PREVIEW_HOST && url.port === PREVIEW_PORT;
}
