import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// In dev the engine runs on :3100 and Vite on :5173. Proxy the API + WS so the
// app can use same-origin relative URLs (which also work in production, where
// the engine serves this bundle directly).
const ENGINE = process.env.ENGINE_URL ?? "http://localhost:3100";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/ws": { target: ENGINE, ws: true },
      "/status": ENGINE,
      "/policy": ENGINE,
      "/address": ENGINE,
      "/sign": ENGINE,
      "/health": ENGINE,
    },
  },
  build: {
    outDir: "dist",
  },
});
