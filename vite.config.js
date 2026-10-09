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
        // Split the large crawled resource inventory and the vendor libraries
        // into their own chunks for better browser caching.
        manualChunks(id) {
          if (id.includes("resources.json")) return "resources";
          if (id.includes("node_modules")) return "vendor";
          return undefined;
        },
      },
    },
  },
});
