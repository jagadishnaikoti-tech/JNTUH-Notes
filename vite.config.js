import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  appType: "spa",
  server: {
    // tools/ holds data-pipeline scripts and audit artifacts, not app source.
    watch: { ignored: ["**/tools/**"] },
  },
  build: {
    rollupOptions: {
      output: {
        // Chunking strategy:
        //   * The generated resource inventory gets its own cacheable chunk.
        //   * Only the always-needed UI libraries are grouped into "vendor".
        //   * Everything else (notably the dynamically-imported Firebase Auth /
        //     Firestore / Analytics SDKs) is left to Rollup, which keeps
        //     dynamically imported code in separate, on-demand chunks. Grouping
        //     all of node_modules into one chunk (the previous behaviour) would
        //     pull the whole Firebase SDK into the bundle every visitor loads.
        manualChunks(id) {
          if (id.includes("resources.json")) return "resources";
          if (
            /[\\/]node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler|lucide-react)[\\/]/.test(
              id
            )
          ) {
            return "vendor";
          }
          return undefined;
        },
      },
    },
  },
});
