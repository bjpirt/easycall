import type { Locator, Page } from "@playwright/test";
import { dropConnection, expect, test } from "./fixtures";

async function expectPlaying(video: Locator): Promise<void> {
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
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

  await dropConnection(caller);

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
