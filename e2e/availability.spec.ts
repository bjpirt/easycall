import { expect, test } from "./fixtures";

test("callers see the receiver's availability and can only join when it's free", async ({
  group,
  receiver,
  caller,
  otherCaller,
}) => {
  const join = (page: typeof caller) => page.getByRole("button", { name: "Join call" });

  await caller.goto(`/${group}/`);
  await otherCaller.goto(`/${group}/`);
  await expect(caller.getByText("Grandma isn't available right now")).toBeVisible();
  await expect(join(caller)).toBeDisabled();

  // The receiver joining makes them available.
  await receiver.goto(`/${group}/`);
  await join(receiver).click();
  await expect(caller.getByText("Grandma is ready for a call")).toBeVisible();
  await expect(join(caller)).toBeEnabled();

  // While one caller is in the call, everyone else sees it's busy.
  await join(caller).click();
  await expect(caller.locator("video.remote-view")).toBeVisible();
  await expect(otherCaller.getByText("Grandma is in a call with Ben")).toBeVisible();
  await expect(join(otherCaller)).toBeDisabled();

  // Hanging up ends the session: the receiver goes back to idle, so it's unavailable.
  await caller.getByRole("button", { name: "Hang up" }).click();
  await expect(otherCaller.getByText("Grandma isn't available right now")).toBeVisible();
  await expect(join(otherCaller)).toBeDisabled();

  // Staff rejoining makes it available again.
  await join(receiver).click();
  await expect(otherCaller.getByText("Grandma is ready for a call")).toBeVisible();
  await expect(join(otherCaller)).toBeEnabled();

  // The receiver leaving makes them unavailable.
  await receiver.close();
  await expect(otherCaller.getByText("Grandma isn't available right now")).toBeVisible();
  await expect(join(otherCaller)).toBeDisabled();
});
