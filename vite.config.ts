import { execSync } from "node:child_process";
import { cloudflare } from "@cloudflare/vite-plugin";
import { defineConfig } from "vite";

// E2E tests supply their own groups, session secret and short timers via env vars.
const vars = Object.fromEntries(
  ["READY_WINDOW_MINUTES", "GRACE_SECONDS", "DIRECTORY", "SESSION_SECRET"].flatMap((name) => {
    const value = process.env[name];
    return value ? [[name, value]] : [];
  }),
);

/** This build's version: the git commit (marked "-dirty" if there are uncommitted changes). */
function version(): string {
  try {
    return execSync("git describe --always --dirty --abbrev=12").toString().trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig({
  plugins: [
    cloudflare({
      ...(Object.keys(vars).length ? { config: { vars } } : {}),
      // E2E rooms start empty each run: saved state could hold a previous run's call.
      persistState: !process.env.E2E,
    }),
  ],
  // Baked into both the Worker and the page, so open pages can tell they're out of date.
  define: { __APP_VERSION__: JSON.stringify(version()) },
  server: { port: 8787 },
});
