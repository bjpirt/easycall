import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Passes once the video is showing frames from a real stream. */
async function expectPlaying(video: Locator): Promise<void> {
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBeGreaterThan(0);
}

test("caller joins and is connected to the waiting receiver", async ({ receiver, caller }) => {
  await receiver.goto("/?role=receiver");
  await receiver.getByRole("button", { name: "Join call" }).click();
  await expect(receiver.getByText("Waiting for a call…")).toBeVisible();

  await caller.goto("/?role=caller");
  await caller.getByRole("button", { name: "Join call" }).click();

  // Each side sees the other full screen, with their own camera in the corner.
  for (const page of [receiver, caller]) {
    await expectPlaying(page.locator("video.remote-view"));
    await expectPlaying(page.locator("video.self-view"));
  }
});
