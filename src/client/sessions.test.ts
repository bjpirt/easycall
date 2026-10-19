import { describe, expect, it } from "vitest";
import { startMedia, stopCamera, type SessionDeps } from "./sessions";
import { FakeSocket, fakeCamera, fakePeer } from "./test-fakes";

const iceServers = [{ urls: ["stun:stun.example.com"] }];

function deps(getCamera: SessionDeps["getCamera"]): SessionDeps {
  return {
    getCamera,
    getIceServers: () => Promise.resolve(iceServers),
    connect: () => new FakeSocket(),
    createPeer: fakePeer,
  };
}

describe("startMedia", () => {
  it("turns on the camera and gets ICE servers", async () => {
    const camera = fakeCamera();

    expect(await startMedia(deps(() => Promise.resolve(camera)))).toEqual({ camera, iceServers });
  });

  it("is undefined if the camera can't start", async () => {
    expect(await startMedia(deps(() => Promise.reject(new Error("denied"))))).toBeUndefined();
  });
});

describe("stopCamera", () => {
  it("stops every track", () => {
    const camera = fakeCamera();

    stopCamera(camera);

    expect(camera.stopped()).toBe(true);
  });
});
