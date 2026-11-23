import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => ({
  root: "demo",
  base: loadEnv(mode, ".", "DEMO_").DEMO_BASE_PATH || "/ChatAtlas/",
  plugins: [react(), {
    name: "static-demo-boundary",
    apply: "build",
    transformIndexHtml: {
      order: "pre",
      handler: () => [{
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" },
        injectTo: "head-prepend",
      }],
    },
    generateBundle(_options, bundle) {
      for (const entry of Object.values(bundle)) {
        if (entry.type !== "chunk") continue;
        const forbidden = Object.keys(entry.modules).find(id => /\/src\/(?:background|content|sidecar)\//u.test(id));
        if (forbidden) this.error("Extension module reached the static demo: " + forbidden);
      }
    },
  }],
  define: { "import.meta.env.VITE_ATLAS_API_BASE_URL": JSON.stringify("") },
  publicDir: false,
  resolve: { conditions: ["worker", ...defaultClientConditions] },
  build: {
    outDir: "../dist-demo",
    emptyOutDir: true,
    target: "es2022",
    manifest: true,
  },
}));
