import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountReceiver, type ReceiverDeps, type RoomSocket } from "./receiver";

class FakeSocket extends EventTarget {
  close = vi.fn();
}

function fakeCamera(): MediaStream & { track: { stop: ReturnType<typeof vi.fn> } } {
  const track = { stop: vi.fn() };
  // happy-dom's MediaStream has no getTracks(), so add one.
  return Object.assign(new MediaStream(), {
    track,
    getTracks: () => [track as unknown as MediaStreamTrack],
  });
}

let root: HTMLElement;
let socket: FakeSocket;
let camera: ReturnType<typeof fakeCamera>;
let deps: ReceiverDeps;

beforeEach(() => {
  root = document.createElement("main");
  socket = new FakeSocket();
  camera = fakeCamera();
  deps = {
    getCamera: vi.fn(() => Promise.resolve(camera)),
    connect: vi.fn(() => socket as unknown as RoomSocket),
  };
});

const joinButton = (): HTMLButtonElement | null => root.querySelector("button");
const selfView = (): HTMLVideoElement | null => root.querySelector("video.self-view");

async function join(): Promise<void> {
  joinButton()?.click();
  await vi.waitFor(() => {
    expect(deps.connect).toHaveBeenCalled();
  });
}

describe("receiver", () => {
  it("starts idle with a Join call button and the camera off", () => {
    mountReceiver(root, deps);

    expect(joinButton()?.textContent).toBe("Join call");
    expect(deps.getCamera).not.toHaveBeenCalled();
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it("joining turns on the camera, connects, and waits once connected", async () => {
    mountReceiver(root, deps);
    await join();

    socket.dispatchEvent(new Event("open"));

    expect(root.textContent).toContain("Waiting for a call");
    expect(selfView()?.srcObject).toBe(camera);
    expect(selfView()?.muted).toBe(true);
  });

  it("doesn't show waiting until the room connection is open", async () => {
    mountReceiver(root, deps);
    await join();

    expect(root.textContent).not.toContain("Waiting for a call");
  });

  it("stays idle with a message if the camera can't start", async () => {
    deps.getCamera = vi.fn(() => Promise.reject(new Error("denied")));
    mountReceiver(root, deps);

    joinButton()?.click();

    await vi.waitFor(() => {
      expect(root.textContent).toContain("Couldn't start the camera.");
    });
    expect(joinButton()).not.toBeNull();
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it("goes back to idle and turns the camera off if the connection is lost", async () => {
    mountReceiver(root, deps);
    await join();
    socket.dispatchEvent(new Event("open"));

    socket.dispatchEvent(new Event("close"));

    expect(joinButton()).not.toBeNull();
    expect(root.textContent).toContain("Lost connection.");
    expect(camera.track.stop).toHaveBeenCalled();
  });
});
