import { test as base, type Browser, type Page } from "@playwright/test";

interface Fixtures {
  /** This test's group: one per parallel worker, so concurrent tests never share a room. */
  group: string;
  receiver: Page;
  caller: Page;
  otherCaller: Page;
}

/** A page in its own browser context (like a separate device) with camera and mic allowed. */
async function peer(
  { browser, baseURL }: { browser: Browser; baseURL: string | undefined },
  use: (page: Page) => Promise<void>,
): Promise<void> {
  const context = await browser.newContext({
    ...(baseURL && { baseURL }),
    permissions: ["camera", "microphone"],
  });
  await use(await context.newPage());
  await context.close();
}

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern
  group: async ({}, use, testInfo) => {
    await use(`e2e-${String(testInfo.parallelIndex)}`);
  },
  receiver: peer,
  caller: peer,
  otherCaller: peer,
});

export { expect } from "@playwright/test";
