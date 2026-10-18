import { expect, test } from "./fixtures";

test("receiver joins: camera on, connected to the room, waiting", async ({ receiver }) => {
  await receiver.goto("/?role=receiver");
  await expect(receiver.locator("video")).toHaveCount(0);

  await receiver.getByRole("button", { name: "Join call" }).click();

  await expect(receiver.getByText("Waiting for a call…")).toBeVisible();
  const selfView = receiver.locator("video.self-view");
  await expect
    .poll(() => selfView.evaluate((video: HTMLVideoElement) => video.videoWidth))
    .toBeGreaterThan(0);
});
