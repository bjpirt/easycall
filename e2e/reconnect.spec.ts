import type { Locator, Page } from "@playwright/test";
import { dropConnection, expect, signIn, test } from "./fixtures";

async function expectPlaying(video: Locator, timeout?: number): Promise<void> {
  await expect
    .poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth), timeout ? { timeout } : {})
    .toBeGreaterThan(0);
}

async function startCall(group: string, receiver: Page, caller: Page): Promise<void> {
  await receiver.goto(`/${group}/`);
  await receiver.getByRole("button", { name: "Join call" }).click();
  await caller.goto(`/${group}/`);
  await caller.getByRole("button", { name: "Join call" }).click();
  await expectPlaying(caller.locator("video.remote-view"));
  await expectPlaying(receiver.locator("video.remote-view"));
}

test("the caller's connection drops and comes back: the call carries on", async ({
  group,
  receiver,
  caller,
}) => {
  await startCall(group, receiver, caller);

  await expect(caller.locator(".notice")).toBeHidden(); // media is flowing: nothing to say

  await dropConnection(caller);

  // The caller is told, until the connection's back (the first retry is after a second).
  await expect(caller.getByText("Reconnecting…")).toBeVisible();
  await expect(caller.locator(".notice")).toBeHidden();

  // Reconnected with its place in the call kept: still connected, and Hang up still works.
  await expect(caller.getByRole("button", { name: "Hang up" })).toBeVisible();
  await expectPlaying(caller.locator("video.remote-view"));
  await expect(receiver.getByText("The call has ended.")).toHaveCount(0);
  await expect
    .poll(() =>
      caller.evaluate(() => (window as unknown as { __sockets: unknown[] }).__sockets.length),
    )
    .toBe(2);

  await caller.getByRole("button", { name: "Hang up" }).click();
  await expect(receiver.getByText("The call has ended.")).toBeVisible();
});

test("the receiver's connection drops and comes back: the call carries on", async ({
  group,
  receiver,
  caller,
}) => {
  await startCall(group, receiver, caller);

  await dropConnection(receiver);

  await expect
    .poll(() =>
      receiver.evaluate(() => (window as unknown as { __sockets: unknown[] }).__sockets.length),
    )
    .toBe(2);
  await expectPlaying(receiver.locator("video.remote-view"));
  await expect(caller.getByText("The call has ended.")).toHaveCount(0);
  await expect(caller.getByRole("button", { name: "Hang up" })).toBeVisible();
});

test("if the caller doesn't come back, the call ends after the grace period", async ({
  group,
  receiver,
  caller,
}) => {
  await startCall(group, receiver, caller);

  await caller.context().close(); // gone, without hanging up

  // The test server's grace period is 3 seconds.
  await expect(receiver.getByText("The call has ended.")).toBeVisible({ timeout: 10_000 });
});

test("the tablet reloads mid-call: staff rejoin and the call recovers by itself", async ({
  group,
  receiver,
  caller,
}) => {
  test.setTimeout(60_000);
  await startCall(group, receiver, caller);

  // Within the grace period, so the room keeps the tablet's place in the call.
  await receiver.reload();
  await receiver.getByRole("button", { name: "Join call" }).click();

  // The caller's connection to the old page breaks; it restarts ICE and the new page answers.
  await expectPlaying(receiver.locator("video.remote-view"), 30_000);
  await expect(caller.getByRole("button", { name: "Hang up" })).toBeVisible();
  await expect(caller.getByText("The call has ended.")).toHaveCount(0);
});

test("the caller closes the app mid-call and reopens it: they can rejoin the call", async ({
  group,
  receiver,
  caller,
}) => {
  await startCall(group, receiver, caller);

  await caller.reload(); // a new page, as when the app is closed and opened again

  await expect(caller.getByText("Your call with Grandma is still going")).toBeVisible();
  await caller.getByRole("button", { name: "Join call" }).click();

  await expect(caller.getByRole("button", { name: "Hang up" })).toBeVisible();
  await expectPlaying(caller.locator("video.remote-view"));
  await expectPlaying(receiver.locator("video.remote-view"));
  await expect(caller.locator(".notice")).toBeHidden({ timeout: 10_000 });
  await expect(receiver.locator(".notice")).toBeHidden();
  // Still in the call after the grace period for the old page has passed.
  await caller.waitForTimeout(4000);
  await expect(receiver.getByText("The call has ended.")).toHaveCount(0);
  await expect(caller.getByRole("button", { name: "Hang up" })).toBeVisible();
});

test("the caller's other device can't take over their call", async ({
  browser,
  group,
  users,
  receiver,
  caller,
}) => {
  await startCall(group, receiver, caller);
  const otherDevice = await (await browser.newContext()).newPage();
  await signIn(otherDevice, users.caller);
  await otherDevice.goto(`/${group}/`);
  await expect(otherDevice.getByText("Grandma is in a call with Ben")).toBeVisible();

  await dropConnection(caller); // the call's device reconnects, and keeps its place

  await expect(caller.getByRole("button", { name: "Hang up" })).toBeVisible();
  await expect(caller.getByText("The call has ended.")).toHaveCount(0);
  await expect
    .poll(() =>
      caller.evaluate(() => (window as unknown as { __sockets: unknown[] }).__sockets.length),
    )
    .toBe(2);
  await expectPlaying(caller.locator("video.remote-view"));
  await expect(otherDevice.getByRole("button", { name: "Join call" })).toBeDisabled();
});
