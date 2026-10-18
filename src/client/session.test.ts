import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../shared/roles";
import { sessionStarter, type SessionDeps, type SessionEvent } from "./session";
import { FakeSocket, fakeCamera, fakePeer, type FakeCamera, type FakePeer } from "./test-fakes";

let socket: FakeSocket;
let camera: FakeCamera;
let peer: FakePeer | undefined;
let deps: SessionDeps;
let events: SessionEvent[];

beforeEach(() => {
  socket = new FakeSocket();
  camera = fakeCamera();
  peer = undefined;
  events = [];
  deps = {
    getCamera: vi.fn(() => Promise.resolve(camera)),
    connect: vi.fn(() => socket),
    createPeer: (options) => (peer = fakePeer(options)),
  };
});

async function start(role: Role): Promise<FakePeer> {
  await sessionStarter(role, deps)((event) => events.push(event));
  if (!peer) throw new Error("No peer created");
  return peer;
}

describe("session", () => {
  it("connects to the room with its role", async () => {
    await start("receiver");

    expect(deps.connect).toHaveBeenCalledWith("receiver");
  });

  it("reports connected once the room connection opens", async () => {
    await start("receiver");
    expect(events).toEqual([]);

    socket.dispatchEvent(new Event("open"));

    expect(events).toEqual([{ type: "connected", camera }]);
  });

  it("the caller starts the call once connected", async () => {
    const p = await start("caller");

    socket.dispatchEvent(new Event("open"));

    expect(p.call).toHaveBeenCalled();
  });

  it("the receiver doesn't start a call", async () => {
    const p = await start("receiver");

    socket.dispatchEvent(new Event("open"));

    expect(p.call).not.toHaveBeenCalled();
  });

  it("passes signals from the room to the peer", async () => {
    const p = await start("receiver");

    socket.receive({ type: "offer", sdp: "OFFER" });
    socket.receive({ type: "nonsense" });

    expect(p.handle).toHaveBeenCalledTimes(1);
    expect(p.handle).toHaveBeenCalledWith({ type: "offer", sdp: "OFFER" });
  });

  it("sends the peer's signals to the room", async () => {
    const p = await start("receiver");

    p.options.send({ type: "answer", sdp: "ANSWER" });

    expect(socket.sent()).toEqual([{ type: "answer", sdp: "ANSWER" }]);
  });

  it("reports the remote stream", async () => {
    const p = await start("caller");
    const remote = new MediaStream();

    p.options.onRemoteStream(remote);

    expect(events).toEqual([{ type: "remote", camera, remote }]);
  });

  it("ends without connecting if the camera can't start", async () => {
    deps.getCamera = () => Promise.reject(new Error("denied"));

    await sessionStarter("caller", deps)((event) => events.push(event));

    expect(events).toEqual([{ type: "ended", reason: "Couldn't start the camera." }]);
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it("tears everything down when the room connection drops", async () => {
    const p = await start("caller");

    socket.dispatchEvent(new Event("close"));

    expect(p.close).toHaveBeenCalled();
    expect(camera.stopped()).toBe(true);
    expect(events).toEqual([{ type: "ended", reason: "Lost connection." }]);
  });
});
