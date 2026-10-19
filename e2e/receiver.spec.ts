import { expect, test } from "./fixtures";

test("receiver joins: camera on, connected to the room, waiting", async ({ group, receiver }) => {
  await receiver.goto(`/${group}/`);
  await expect(receiver.locator("video")).toHaveCount(0);

  await receiver.getByRole("button", { name: "Join Call" }).click();

  await expect(receiver.getByText("Waiting for a call…")).toBeVisible();
  const selfView = receiver.locator("video.self-view");
  await expect
    .poll(() => selfView.evaluate((video: HTMLVideoElement) => video.videoWidth))
    .toBeGreaterThan(0);
});

test("staff can end waiting: the receiver is unavailable straight away", async ({
  group,
  receiver,
  caller,
}) => {
  await caller.goto(`/${group}/`);
  await receiver.goto(`/${group}/`);
  await receiver.getByRole("button", { name: "Join Call" }).click();
  await expect(caller.getByText("Grandma is ready for a call")).toBeVisible();

  await receiver.getByRole("button", { name: "End Call" }).click();

  await expect(receiver.getByRole("button", { name: "Join Call" })).toBeVisible();
  await expect(receiver.locator("video")).toHaveCount(0);
  // Straight away, not after the grace period (3 s on the test server).
  await expect(caller.getByText("Grandma isn't available right now")).toBeVisible({
    timeout: 2000,
  });
});
