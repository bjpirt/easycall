import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectCaller,
  type CallerDeps,
  type CallerEvent,
  type CallerSession,
} from "./caller-session";
import { FakeSocket, fakeCamera, fakePeer, type FakeCamera, type FakePeer } from "./test-fakes";

let sockets: FakeSocket[];
let camera: FakeCamera;
let peers: FakePeer[];
let deps: CallerDeps;
const iceServers = [{ urls: ["turn:turn.example.com:3478"], username: "u", credential: "c" }];
let events: CallerEvent[];
let session: CallerSession;

const socket = (): FakeSocket => {
  const latest = sockets.at(-1);
  if (!latest) throw new Error("Not connected yet");
  return latest;
};

beforeEach(() => {
  sockets = [];
  camera = fakeCamera();
  peers = [];
  events = [];
  deps = {
    getCamera: vi.fn(() => Promise.resolve(camera)),
    getIceServers: () => Promise.resolve(iceServers),
    connect: vi.fn(() => {
      const next = new FakeSocket();
      sockets.push(next);
      return next;
    }),
    createPeer: (options) => {
      const peer = fakePeer(options);
      peers.push(peer);
      return peer;
    },
  };
  session = connectCaller(deps, (event) => events.push(event));
  socket().receive({ type: "welcome", resumed: false });
});

afterEach(() => {
  vi.useRealTimers();
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

/** The connection drops, and (after the first retry delay) reconnects. */
function dropAndReconnect(): void {
  vi.useFakeTimers();
  socket().dispatchEvent(new CloseEvent("close", { code: 1006 }));
  vi.advanceTimersByTime(1000);
  vi.useRealTimers();
}

describe("caller session", () => {
  it("connects to the room straight away, before any call", () => {
    expect(deps.connect).toHaveBeenCalled();
    expect(deps.getCamera).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: "connection", state: "connected" }]);
  });

  it("reports the receiver's availability", () => {
    socket().receive({ type: "status", status: "available" });

    expect(events.at(-1)).toEqual({ type: "status", status: "available" });
  });

  it("join turns on the camera and asks the room for the call", async () => {
    await join();

    expect(events.at(-1)).toEqual({ type: "calling", camera });
    expect(socket().sent()).toEqual([{ type: "join" }]);
  });

  it("sets up the peer with the call's ICE servers", async () => {
    const peer = await join();

    expect(peer.options.iceServers).toBe(iceServers);
  });

  it("only sends its offer once the room says it's in the call", async () => {
    const peer = await join();
    expect(peer.call).not.toHaveBeenCalled();

    socket().receive({ type: "joined" });

    expect(peer.call).toHaveBeenCalled();
  });

  it.each([
    ["in-call", "Someone else is in a call right now."],
    ["unavailable", "Not available right now."],
  ] as const)("if refused while %s, ends the call explaining why", async (status, reason) => {
    const peer = await join();
    socket().receive({ type: "status", status });

    socket().receive({ type: "refused" });

    expect(peer.call).not.toHaveBeenCalled();
    expect(peer.close).toHaveBeenCalled();
    expect(camera.stopped()).toBe(true);
    expect(events.at(-1)).toEqual({ type: "call-ended", reason });
  });

  it("passes signals to the peer, sends the peer's to the room, and reports the video", async () => {
    const peer = await join();
    const remote = new MediaStream();

    socket().receive({ type: "answer", sdp: "ANSWER" });
    peer.options.send({
      type: "candidate",
      candidate: { candidate: "c", sdpMid: "0", sdpMLineIndex: 0 },
    });
    peer.options.onRemoteStream(remote);

    expect(peer.handle).toHaveBeenCalledWith({ type: "answer", sdp: "ANSWER" });
    expect(socket().sent().at(-1)).toMatchObject({ type: "candidate" });
    expect(events.at(-1)).toEqual({ type: "remote", camera, remote });
  });

  it("hang up tells the room, turns the camera off and ends the call quietly", async () => {
    const peer = await join();

    session.hangUp();

    expect(socket().sent()).toEqual([{ type: "join" }, { type: "hangup" }]);
    expect(peer.close).toHaveBeenCalled();
    expect(camera.stopped()).toBe(true);
    expect(socket().close).not.toHaveBeenCalled(); // still watching availability
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
    expect(socket().send).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "call-ended" });
  });

  it("the call ends if the receiver leaves", async () => {
    await join();

    socket().receive({ type: "hangup" });

    expect(camera.stopped()).toBe(true);
    expect(events.at(-1)).toEqual({ type: "call-ended", reason: "The call has ended." });
  });

  it("reports a camera failure", async () => {
    deps.getCamera = () => Promise.reject(new Error("denied"));

    session.join();

    await vi.waitFor(() => {
      expect(events.at(-1)).toEqual({ type: "call-ended", reason: "Couldn't start the camera." });
    });
    expect(socket().send).not.toHaveBeenCalled();
  });

  it("ignores join until the room has welcomed us", () => {
    sockets = [];
    session = connectCaller(deps, (event) => events.push(event));

    session.join();

    expect(deps.getCamera).not.toHaveBeenCalled();
  });

  describe("when the connection drops", () => {
    it("reports reconnecting, without ending the call", async () => {
      const peer = await join();

      socket().dispatchEvent(new CloseEvent("close", { code: 1006 }));

      expect(events.at(-1)).toEqual({ type: "connection", state: "reconnecting" });
      expect(peer.close).not.toHaveBeenCalled();
      expect(camera.stopped()).toBe(false);
    });

    it("carries on the call if the room kept our place", async () => {
      const peer = await join();
      dropAndReconnect();

      socket().receive({ type: "welcome", resumed: true });

      expect(sockets).toHaveLength(2);
      expect(peer.close).not.toHaveBeenCalled();
      expect(events.at(-1)).toEqual({ type: "connection", state: "connected" });
    });

    it("ends the call if the room didn't keep our place", async () => {
      await join();
      dropAndReconnect();

      socket().receive({ type: "welcome", resumed: false });

      expect(camera.stopped()).toBe(true);
      expect(events.at(-1)).toEqual({ type: "call-ended", reason: "The call has ended." });
    });

    it("can't join while reconnecting", () => {
      socket().dispatchEvent(new CloseEvent("close", { code: 1006 }));

      session.join();

      expect(deps.getCamera).not.toHaveBeenCalled();
    });

    it("ends any call if the room closes the connection for good", async () => {
      await join();

      socket().dispatchEvent(new CloseEvent("close", { code: 4000 }));

      expect(camera.stopped()).toBe(true);
      expect(events.slice(-2)).toEqual([
        { type: "call-ended" },
        { type: "connection", state: "closed" },
      ]);
    });
  });
});
