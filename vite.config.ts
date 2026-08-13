import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { isValidDevelopmentPrinterHost } from "./src/lib/printerHost";

/** The route the app opens on. Everyone pays its load; nobody chose it. */
const LANDING_ROUTE_MODULE = "src/pages/Dashboard.tsx";

/**
 * Declare the LANDING route's chunk graph in the HTML, so the browser fetches
 * it alongside the entry instead of discovering it afterwards.
 *
 * Every route is lazy, which is right for six of the seven — but "/" is not a
 * route the owner navigates to, it is the one the app boots into. Its import
 * is invisible to the preload scanner: the browser cannot know the chunk
 * exists until the entry has downloaded, parsed, executed, and rendered far
 * enough to hit the Suspense boundary. Measured at 800x480 / 4x CPU / 60ms
 * RTT, that discovery cost 179ms of dead air after the shell chunks landed,
 * and the route wave that followed defined FCP at 612ms.
 *
 * `modulepreload` is the whole fix: same chunks, same laziness, same cache
 * keys — they are simply requested in the first wave rather than the second.
 * Only the landing route is declared. Preloading the other six would put
 * views nobody opened on every cold boot, which is the bug this avoids, not
 * a bigger version of the cure.
 */
function preloadLandingRoute(): Plugin {
  let base = "/";
  return {
    name: "regolith:preload-landing-route",
    apply: "build",
    configResolved(resolved) {
      base = resolved.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        const bundle = ctx.bundle;
        if (!bundle) return;

        const entry = Object.values(bundle).find(
          (chunk) =>
            chunk.type === "chunk" &&
            chunk.facadeModuleId?.replace(/\\/g, "/").endsWith(LANDING_ROUTE_MODULE),
        );
        if (!entry || entry.type !== "chunk") {
          // A renamed or deleted landing route must not silently degrade to
          // "no preload at all" — that is a perf regression nobody would see.
          throw new Error(
            `preloadLandingRoute: no chunk for ${LANDING_ROUTE_MODULE}. ` +
              "Update LANDING_ROUTE_MODULE in vite.config.ts.",
          );
        }

        // The entry chunk and everything it statically needs. Without the
        // transitive walk the browser would still serialise a second wave on
        // whatever the route imports.
        const graph = new Set<string>();
        const walk = (fileName: string) => {
          if (graph.has(fileName)) return;
          graph.add(fileName);
          const chunk = bundle[fileName];
          if (chunk?.type === "chunk") chunk.imports.forEach(walk);
        };
        walk(entry.fileName);

        // Anything the HTML already references is fetched in wave one.
        const declared = new Set<string>();
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== "chunk" || !chunk.isEntry) continue;
          declared.add(chunk.fileName);
          chunk.imports.forEach((name) => declared.add(name));
        }

        return [...graph]
          .filter((fileName) => !declared.has(fileName))
          .sort()
          .map((fileName) => ({
            tag: "link",
            injectTo: "head" as const,
            attrs: {
              rel: "modulepreload",
              crossorigin: "",
              href: `${base}${fileName}`,
            },
          }));
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  const printerHost = (
    environment.VITE_REGOLITH_PRINTER_HOST || "forge.local"
  ).trim();
  if (!isValidDevelopmentPrinterHost(printerHost)) {
    throw new Error(
      "VITE_REGOLITH_PRINTER_HOST must be a plain trusted hostname or IPv4 address.",
    );
  }

  const httpTarget = `http://${printerHost}`;
  const wsTarget = `ws://${printerHost}`;

  /**
   * Where the PREVIEW server's proxy points: a loopback sink, never a
   * printer. Port 9 is the discard port; nothing listens there.
   *
   * A LEAK MUST ANNOUNCE ITSELF. Keeping the routes and aiming them at a
   * sink — rather than deleting the table — means a leak still FAILS,
   * instantly and locally, with ECONNREFUSED in the preview log. An empty
   * `proxy: {}` would be just as safe for the printer but strictly worse as
   * a diagnostic: the leaked request would fall through to the SPA's
   * index.html, return 200, and look like success, hiding the spec that
   * leaked. Given a choice between two safe designs, take the one that
   * cannot fail silently.
   */
  const sinkHttp = "http://127.0.0.1:9";
  const sinkWs = "ws://127.0.0.1:9";

  return {
    plugins: [react(), tailwindcss(), preloadLandingRoute()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      proxy: {
        "/printer": httpTarget,
        "/server": httpTarget,
        "/access": httpTarget,
        "/machine": httpTarget,
        "/api": httpTarget,
        "/webcam": httpTarget,
        "/websocket": {
          target: wsTarget,
          ws: true,
          changeOrigin: true,
          rewriteWsOrigin: true,
          configure: (proxy) => {
            proxy.on("proxyReqWs", (proxyReq) => {
              proxyReq.setHeader("Origin", httpTarget);
            });
          },
        },
      },
    },
    /*
     * THE E2E ARTIFACT MUST NOT BE ABLE TO REACH A PRINTER.
     *
     * This block is the ONLY thing that makes the sink above take effect —
     * without an explicit `preview.proxy`, Vite falls through to
     * `server.proxy` and the preview server holds live routes to the real
     * machine. `bun run preview` is the e2e gate's own webServer, so that
     * fallthrough put a printer-wired server underneath every test run.
     *
     * Observed on 2026-08-12 while the owner had an 8-hour print running:
     * `[vite] ws proxy error: connect EHOSTUNREACH <printer>:80`, logged by
     * a suite that is supposed to be hermetic. Those attempts failed at the
     * network layer, so nothing reached Klipper — but the only thing that
     * stopped them was the printer happening to be unreachable at that
     * moment, which is not a safety mechanism.
     *
     * THE DURABLE LESSON (see working.md): the suite seals at the BROWSER —
     * `page.route` + `routeWebSocket`, asserted by `assertSealed()`. That is
     * the right layer for "the app makes no unmocked calls", and it is one
     * layer too HIGH to be a containment guarantee. Anything that reaches
     * the preview ORIGIN is forwarded by the server itself, entirely outside
     * Playwright's view — so the suite could report zero escaped requests
     * while the server under it talked to a live printer. A seal has to sit
     * at the outermost layer that can egress, not at the layer that is
     * convenient to assert.
     *
     * Dev keeps the real proxy above: `vite dev` is how a human drives an
     * actual machine on purpose. Nothing in the e2e suite needs it.
     */
    preview: {
      proxy: {
        "/printer": sinkHttp,
        "/server": sinkHttp,
        "/access": sinkHttp,
        "/machine": sinkHttp,
        "/api": sinkHttp,
        "/webcam": sinkHttp,
        "/websocket": { target: sinkWs, ws: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      target: "es2022",
    },
  };
});
