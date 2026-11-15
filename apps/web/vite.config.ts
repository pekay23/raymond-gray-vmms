import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const apiOrigin = process.env.VMMS_API_ORIGIN ?? "http://127.0.0.1:4100";
const webPort = Number(process.env.VMMS_WEB_PORT ?? "5173");

if (!Number.isSafeInteger(webPort) || webPort < 1024 || webPort > 65535) {
  throw new Error("VMMS_WEB_PORT must be an integer between 1024 and 65535.");
}

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    port: webPort,
    strictPort: true,
    proxy: { "/api": { target: apiOrigin } },
  },
  build: {
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
