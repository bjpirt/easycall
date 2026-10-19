import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/**
 * The manifest Chrome itself fetched (with the session cookie) and parsed for the
 * page. (Chrome's installability check isn't available in the headless test
 * browser, so whether it actually offers to install is checked on real devices.)
 */
async function chromeManifest(page: Page): Promise<unknown> {
  const cdp = await page.context().newCDPSession(page);
  const { data, errors } = await cdp.send("Page.getAppManifest");
  expect(errors).toEqual([]);
  return data ? (JSON.parse(data) as unknown) : undefined;
}

test("the tablet gets the full-screen app's manifest", async ({ group, receiver }) => {
  await receiver.goto(`/${group}/`);

  await expect
    .poll(() => chromeManifest(receiver))
    .toMatchObject({
      name: "easyCall",
      display: "fullscreen",
      start_url: `/${group}/`,
      scope: `/${group}/`,
    });
});

test("a caller gets an app named after who they're calling", async ({ group, caller }) => {
  await caller.goto(`/${group}/`);

  await expect
    .poll(() => chromeManifest(caller))
    .toMatchObject({
      name: "Call Grandma",
      display: "standalone",
    });
});

test("the icons are served to anyone (they're public)", async ({ caller }) => {
  await caller.context().clearCookies();

  for (const icon of ["icon-192.png", "icon-512.png", "apple-touch-icon.png"]) {
    const response = await caller.request.get(`/icons/${icon}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toBe("image/png");
  }
});
