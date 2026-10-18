import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectCaller,
  type CallerDeps,
  type CallerEvent,
  type CallerSession,
} from "./caller-session";
import { FakeSocket, fakeCamera, fakePeer, type FakeCamera, type FakePeer } from "./test-fakes";

let socket: FakeSocket;
let camera: FakeCamera;
let peers: FakePeer[];
let deps: CallerDeps;
const iceServers = [{ urls: ["turn:turn.example.com:3478"], username: "u", credential: "c" }];
let events: CallerEvent[];
let session: CallerSession;

beforeEach(() => {
  socket = new FakeSocket();
  camera = fakeCamera();
  peers = [];
  events = [];
  deps = {
    getCamera: vi.fn(() => Promise.resolve(camera)),
    getIceServers: () => Promise.resolve(iceServers),
    connect: vi.fn(() => socket),
    createPeer: (options) => {
      const peer = fakePeer(options);
      peers.push(peer);
      return peer;
    },
  };
  session = connectCaller(deps, (event) => events.push(event));
  socket.dispatchEvent(new Event("open"));
});

/** Joins and waits until the camera is on and the join has been sent. */
async function join(): Promise<FakePeer> {
  session.join();
  await vi.waitFor(() => {
    expect(peers).toHaveLength(1);
  });
  const [peer] = peers;
  if (!peer) throw new Error("No peer created");
  return peer;
}

describe("caller session", () => {
  it("connects to the room straight away, before any call", () => {
    expect(deps.connect).toHaveBeenCalled();
    expect(deps.getCamera).not.toHaveBeenCalled();
  });

  it("reports the receiver's availability", () => {
    socket.receive({ type: "status", status: "available" });

    expect(events).toEqual([{ type: "status", status: "available" }]);
  });

  it("join turns on the camera and asks the room for the call", async () => {
    await join();

    expect(events).toEqual([{ type: "calling", camera }]);
    expect(socket.sent()).toEqual([{ type: "join" }]);
  });

  it("sets up the peer with the call's ICE servers", async () => {
    const peer = await join();

    expect(peer.options.iceServers).toBe(iceServers);
  });

  it("only sends its offer once the room says it's in the call", async () => {
    const peer = await join();
    expect(peer.call).not.toHaveBeenCalled();

    socket.receive({ type: "joined" });

    expect(peer.call).toHaveBeenCalled();
  });

  it.each([
    ["in-call", "Someone else is in a call right now."],
    ["unavailable", "Not available right now."],
  ] as const)("if refused while %s, ends the call explaining why", async (status, reason) => {
    const peer = await join();
    socket.receive({ type: "status", status });

    socket.receive({ type: "refused" });

    expect(peer.call).not.toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalled();
    expect(camera.stopped()).toBe(true);
    expect(events.at(-1)).toEqual({ type: "call-ended", reason });
  });

  it("passes signals to the peer and reports the receiver's video", async () => {
    const peer = await join();
    const remote = new MediaStream();

    socket.receive({ type: "answer", sdp: "ANSWER" });
    peer.options.onRemoteStream(remote);

    expect(peer.handle).toHaveBeenCalledWith({ type: "answer", sdp: "ANSWER" });
    expect(events).toContainEqual({ type: "remote", camera, remote });
  });

  it("hang up tells the room, turns the camera off and ends the call quietly", async () => {
    const peer = await join();

    session.hangUp();

    expect(socket.sent()).toEqual([{ type: "join" }, { type: "hangup" }]);
    expect(peer.close).toHaveBeenCalled();
    expect(camera.stopped()).toBe(true);
    expect(socket.close).not.toHaveBeenCalled(); // still watching availability
    expect(events.at(-1)).toEqual({ type: "call-ended" });
  });

  it("hanging up while the camera starts cancels the join", async () => {
    let resolveCamera: (camera: MediaStream) => void = () => undefined;
    deps.getCamera = () => new Promise((resolve) => (resolveCamera = resolve));

    session.join();
    session.hangUp();
    resolveCamera(camera);

    await vi.waitFor(() => {
      expect(camera.stopped()).toBe(true);
    });
    expect(socket.send).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "call-ended" }]);
  });

  it("the call ends if the receiver leaves", async () => {
    await join();

    socket.receive({ type: "hangup" });

    expect(camera.stopped()).toBe(true);
    expect(events.at(-1)).toEqual({ type: "call-ended", reason: "The call has ended." });
  });

  it("reports a camera failure", async () => {
    deps.getCamera = () => Promise.reject(new Error("denied"));

    session.join();

    await vi.waitFor(() => {
      expect(events).toEqual([{ type: "call-ended", reason: "Couldn't start the camera." }]);
    });
    expect(socket.send).not.toHaveBeenCalled();
  });

  it("losing the connection ends any call and reports it", async () => {
    await join();

    socket.dispatchEvent(new Event("close"));

    expect(camera.stopped()).toBe(true);
    expect(events.slice(-2)).toEqual([{ type: "call-ended" }, { type: "disconnected" }]);
  });

  it("ignores join until the room connection is open", () => {
    socket = new FakeSocket();
    session = connectCaller({ ...deps, connect: () => socket }, (event) => events.push(event));

    session.join();

    expect(deps.getCamera).not.toHaveBeenCalled();
  });
});
