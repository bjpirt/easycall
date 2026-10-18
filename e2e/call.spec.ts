import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Passes once the video is showing frames from a real stream. */
async function expectPlaying(video: Locator): Promise<void> {
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
}

async function join(page: Page, role: "receiver" | "caller"): Promise<void> {
  await page.goto(`/?role=${role}`);
  await page.getByRole("button", { name: "Join call" }).click();
}

async function expectConnected(receiver: Page, caller: Page): Promise<void> {
  // Each side sees the other full screen, with their own camera in the corner.
  for (const page of [receiver, caller]) {
    await expectPlaying(page.locator("video.remote-view"));
    await expectPlaying(page.locator("video.self-view"));
  }
}

test("caller joins and is connected to the waiting receiver", async ({ receiver, caller }) => {
  await join(receiver, "receiver");
  await expect(receiver.getByText("Waiting for a call…")).toBeVisible();

  await join(caller, "caller");

  await expectConnected(receiver, caller);
});

test("caller hangs up: caller back to idle, receiver waits for the next call", async ({
  receiver,
  caller,
}) => {
  await join(receiver, "receiver");
  await join(caller, "caller");
  await expectConnected(receiver, caller);

  await caller.getByRole("button", { name: "Hang up" }).click();

  await expect(caller.getByRole("button", { name: "Join call" })).toBeVisible();
  await expect(caller.locator("video")).toHaveCount(0);
  await expect(receiver.getByText("Waiting for a call…")).toBeVisible();
  await expect(receiver.locator("video.remote-view")).toHaveCount(0);

  // The receiver is ready for another call.
  await caller.getByRole("button", { name: "Join call" }).click();
  await expectConnected(receiver, caller);
});
