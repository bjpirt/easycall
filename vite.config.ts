import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// E2E tests supply their own groups and a short ready window via env vars.
const vars = Object.fromEntries(
  ["READY_WINDOW_MINUTES", "DIRECTORY"].flatMap((name) => {
    const value = process.env[name];
    return value ? [[name, value]] : [];
  }),
);

export default defineConfig({
  plugins: [cloudflare(Object.keys(vars).length ? { config: { vars } } : {})],
  server: { port: 8787 },
});
