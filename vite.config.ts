import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { isValidDevelopmentPrinterHost } from "./src/lib/printerHost";

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
    plugins: [react(), tailwindcss()],
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
