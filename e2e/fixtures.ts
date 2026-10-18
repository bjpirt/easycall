import { test as base, type Browser, type Page } from "@playwright/test";

interface Peers {
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

export const test = base.extend<Peers>({ receiver: peer, caller: peer, otherCaller: peer });

export { expect } from "@playwright/test";
