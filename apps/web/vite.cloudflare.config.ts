import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  build: {
    outDir: "dist",
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{
            name: "vendor",
            test: /node_modules[\\/]/,
            minSize: 24_000,
            maxSize: 300_000,
            priority: 10,
          }],
        },
      },
    },
  },
});
