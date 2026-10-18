import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Passes once the video is showing frames from a real stream. */
async function expectPlaying(video: Locator): Promise<void> {
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
}

async function join(page: Page, group: string, role: "receiver" | "caller"): Promise<void> {
  await page.goto(`/${group}/?role=${role}`);
  await page.getByRole("button", { name: "Join call" }).click();
}

async function expectConnected(receiver: Page, caller: Page): Promise<void> {
  // Each side sees the other full screen, with their own camera in the corner.
  for (const page of [receiver, caller]) {
    await expectPlaying(page.locator("video.remote-view"));
    await expectPlaying(page.locator("video.self-view"));
  }
}

test("caller joins and is connected to the waiting receiver", async ({
  group,
  receiver,
  caller,
}) => {
  await join(receiver, group, "receiver");
  await expect(receiver.getByText("Waiting for a call…")).toBeVisible();

  await join(caller, group, "caller");

  await expectConnected(receiver, caller);
});

test("caller hangs up: receiver shows the call has ended, staff can rejoin", async ({
  group,
  receiver,
  caller,
}) => {
  await join(receiver, group, "receiver");
  await join(caller, group, "caller");
  await expectConnected(receiver, caller);

  await caller.getByRole("button", { name: "Hang up" }).click();

  // The receiver goes back to idle with a message; the camera is off.
  await expect(receiver.getByText("The call has ended.")).toBeVisible();
  await expect(receiver.getByRole("button", { name: "Join call" })).toBeVisible();
  await expect(receiver.locator("video")).toHaveCount(0);
  // The caller goes quietly back to idle and sees the receiver is unavailable.
  await expect(caller.getByText("Not available right now")).toBeVisible();
  await expect(caller.locator("video")).toHaveCount(0);

  // Staff tap Join call to make the receiver available again.
  await receiver.getByRole("button", { name: "Join call" }).click();
  await caller.getByRole("button", { name: "Join call" }).click();
  await expectConnected(receiver, caller);
});
