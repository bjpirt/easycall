import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Collects the page's Content-Security-Policy violations. */
function violations(page: Page): string[] {
  const found: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) found.push(message.text());
  });
  return found;
}

test("pages are served with security headers", async ({ group, caller }) => {
  for (const path of [`/${group}/`, "/"]) {
    const headers = (await caller.goto(path))?.headers() ?? {};

    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["referrer-policy"]).toBe("no-referrer");
  }
});

test("a whole call works within the Content-Security-Policy", async ({
  group,
  receiver,
  caller,
}) => {
  const blocked = [violations(receiver), violations(caller)];

  await receiver.goto(`/${group}/`);
  await receiver.getByRole("button", { name: "Join Call" }).click();
  await caller.goto(`/${group}/`);
  await caller.getByRole("button", { name: "Join Call" }).click();
  for (const page of [caller, receiver]) {
    await expect
      .poll(() => page.locator("video.remote-view").evaluate((v: HTMLVideoElement) => v.videoWidth))
      .toBeGreaterThan(0);
  }
  await caller.getByRole("button", { name: "End Call" }).click();
  await expect(receiver.getByText("The call has ended.")).toBeVisible();

  expect(blocked.flat()).toEqual([]);
});

test("the home page is styled within the Content-Security-Policy", async ({ caller }) => {
  await caller.context().clearCookies();
  const blocked = violations(caller);

  await caller.goto("/");

  await expect(caller.locator("html")).toHaveCSS("background-color", "rgb(17, 17, 17)");
  expect(blocked).toEqual([]);
});
