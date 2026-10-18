import { expect, test } from "./fixtures";

test("callers see the receiver's availability and can only join when it's free", async ({
  receiver,
  caller,
  otherCaller,
}) => {
  const join = (page: typeof caller) => page.getByRole("button", { name: "Join call" });

  await caller.goto("/?role=caller");
  await otherCaller.goto("/?role=caller");
  await expect(caller.getByText("Not available right now")).toBeVisible();
  await expect(join(caller)).toBeDisabled();

  // The receiver joining makes them available.
  await receiver.goto("/?role=receiver");
  await join(receiver).click();
  await expect(caller.getByText("Ready for a call")).toBeVisible();
  await expect(join(caller)).toBeEnabled();

  // While one caller is in the call, everyone else sees it's busy.
  await join(caller).click();
  await expect(caller.locator("video.remote-view")).toBeVisible();
  await expect(otherCaller.getByText("In a call")).toBeVisible();
  await expect(join(otherCaller)).toBeDisabled();

  // Hanging up ends the session: the receiver goes back to idle, so it's unavailable.
  await caller.getByRole("button", { name: "Hang up" }).click();
  await expect(otherCaller.getByText("Not available right now")).toBeVisible();
  await expect(join(otherCaller)).toBeDisabled();

  // Staff rejoining makes it available again.
  await join(receiver).click();
  await expect(otherCaller.getByText("Ready for a call")).toBeVisible();
  await expect(join(otherCaller)).toBeEnabled();

  // The receiver leaving makes them unavailable.
  await receiver.close();
  await expect(otherCaller.getByText("Not available right now")).toBeVisible();
  await expect(join(otherCaller)).toBeDisabled();
});
