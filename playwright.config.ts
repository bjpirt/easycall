import { defineConfig, devices } from "@playwright/test";

const port = 8788;

export default defineConfig({
  testDir: "e2e",
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
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
          // Synthetic camera/microphone, and no permission prompts.
          args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
        },
      },
    },
  ],
  webServer: {
    command: `npx wrangler dev --port ${String(port)}`,
    url: `http://localhost:${String(port)}`,
    reuseExistingServer: !process.env.CI,
  },
});
