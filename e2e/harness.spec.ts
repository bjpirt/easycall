import { expect, test } from "./fixtures";

test("serves the app at a group's URL, and 404s otherwise", async ({ group, receiver }) => {
  const app = await receiver.goto(`/${group}/`);
  expect(app?.status()).toBe(200);
  await expect(receiver.locator("#app")).toBeAttached();

  for (const path of ["/no-such-group/", "/no-such-group/api/me"]) {
    expect((await receiver.goto(path))?.status()).toBe(404);
  }
});

test("receiver and caller each get a fake camera", async ({ group, receiver, caller }) => {
  for (const page of [receiver, caller]) {
    await page.goto(`/${group}/`);
    const videoTracks = await page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      return stream.getVideoTracks().length;
    });
    expect(videoTracks).toBe(1);
  }
});
