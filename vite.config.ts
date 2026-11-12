import { defaultClientConditions, defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { createManifest } from "./manifest.config";

export default defineConfig(({ command }) => ({
  plugins: [react(), crx({ manifest: createManifest() })],
  define: { "import.meta.env.VITE_ATLAS_API_BASE_URL": JSON.stringify("") },
  // The extension shares Markdown rendering with dedicated workers. Prefer
  // worker-safe dependency exports when a package offers both browser variants.
  resolve: { conditions: ["worker", ...defaultClientConditions] },
  worker: { format: "es" },
  build: {
    // CRXJS writes its development loader into the build directory. Keep that
    // loader away from the unpacked production extension so stopping Vite can
    // never leave the toolbar action pointing at localhost.
    outDir: command === "serve" ? "dist-dev" : "dist",
    emptyOutDir: true,
    sourcemap: true,
    target: "es2022",
    rollupOptions: {
      input: {
        atlas: "atlas.html",
        sidecar: "sidecar.html",
      },
    },
  },
}));
