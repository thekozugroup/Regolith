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
    build: {
      outDir: "dist",
      sourcemap: false,
      target: "es2022",
    },
  };
});
