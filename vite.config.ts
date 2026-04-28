import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/printer": "http://192.168.50.179",
      "/server": "http://192.168.50.179",
      "/access": "http://192.168.50.179",
      "/machine": "http://192.168.50.179",
      "/api": "http://192.168.50.179",
      "/webcam": "http://192.168.50.179",
      "/websocket": {
        target: "ws://192.168.50.179",
        ws: true,
        changeOrigin: true,
        rewriteWsOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReqWs", (proxyReq) => {
            // Rewrite Origin so moonraker sees printer's own host as origin
            proxyReq.setHeader("Origin", "http://192.168.50.179");
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
});
