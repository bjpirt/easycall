import { expect, test } from "./fixtures";

test("serves the home page", async ({ receiver }) => {
  await receiver.goto("/");

  await expect(receiver.getByRole("heading", { name: "easyCall" })).toBeVisible();
});

test("receiver and caller each get a fake camera", async ({ receiver, caller }) => {
  for (const page of [receiver, caller]) {
    await page.goto("/");
    const videoTracks = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      return stream.getVideoTracks().length;
    });
    expect(videoTracks).toBe(1);
  }
});
