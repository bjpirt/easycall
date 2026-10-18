import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// E2E tests shorten the ready window so the timeout can be tested.
const readyWindow = process.env.READY_WINDOW_MINUTES;

export default defineConfig({
  plugins: [
    cloudflare(readyWindow ? { config: { vars: { READY_WINDOW_MINUTES: readyWindow } } } : {}),
  ],
  server: { port: 8787 },
});
