import { defineConfig, devices } from "@playwright/test";

const port = 8788;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Every test shares the single dev room until per-group rooms arrive (step 13),
  // so tests must not run in parallel. Remove this then.
  workers: 1,
  use: {
    baseURL: `http://localhost:${String(port)}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // Synthetic camera/microphone and no permission prompts. Loopback ICE
          // candidates let the two peers connect even when a host firewall (e.g.
          // macOS stealth mode) drops LAN traffic to the unsigned test browser.
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
            "--allow-loopback-in-peer-connection",
          ],
        },
      },
    },
  ],
  webServer: {
    command: `npm run build && npx vite preview --port ${String(port)} --strictPort`,
    url: `http://localhost:${String(port)}`,
    reuseExistingServer: !process.env.CI,
    // A 6-second ready window, so the timeout test doesn't take 30 minutes.
    env: { READY_WINDOW_MINUTES: "0.1" },
  },
});
