import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  receiverStarter,
  type ReceiverDeps,
  type ReceiverEvent,
  type ReceiverSession,
} from "./receiver-session";
import { FakeSocket, fakeCamera, fakePeer, type FakeCamera, type FakePeer } from "./test-fakes";

let sockets: FakeSocket[];
let camera: FakeCamera;
let peers: FakePeer[];
let deps: ReceiverDeps;
const iceServers = [{ urls: ["turn:turn.example.com:3478"], username: "u", credential: "c" }];
let events: ReceiverEvent[];

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
});

afterEach(() => {
  vi.useRealTimers();
});

/** Starts the session and waits until it has connected to the room. */
async function start(): Promise<{ session: ReceiverSession; peer: FakePeer }> {
  const session = receiverStarter(deps)((event) => events.push(event));
  await vi.waitFor(() => {
    expect(peers).toHaveLength(1);
  });
  const [peer] = peers;
  if (!peer) throw new Error("No peer created");
  return { session, peer };
}

/** Starts, is welcomed by the room, and receives the caller's video. */
async function inCall(): Promise<FakePeer> {
  const { peer } = await start();
  socket().receive({ type: "welcome", resumed: false });
  peer.options.onRemoteStream(new MediaStream());
  return peer;
}

function dropAndReconnect(): void {
  vi.useFakeTimers();
  socket().dispatchEvent(new CloseEvent("close", { code: 1006 }));
  vi.advanceTimersByTime(1000);
  vi.useRealTimers();
}

describe("receiver session", () => {
  it("waits once the room welcomes it", async () => {
    await start();
    expect(events).toEqual([]);

    socket().receive({ type: "welcome", resumed: false });

    expect(events).toEqual([
      { type: "connection", state: "connected" },
      { type: "waiting", camera },
    ]);
  });

  it("sets up the peer with the call's ICE servers and never starts a call itself", async () => {
    const { peer } = await start();
    socket().receive({ type: "welcome", resumed: false });

    expect(peer.options.iceServers).toBe(iceServers);
    expect(peer.call).not.toHaveBeenCalled();
  });

  it("passes signals to the peer and ignores everything else", async () => {
    const { peer } = await start();

    socket().receive({ type: "offer", sdp: "OFFER" });
    socket().receive({ type: "status", status: "available" });
    socket().receive({ type: "nonsense" });

    expect(peer.handle).toHaveBeenCalledTimes(1);
    expect(peer.handle).toHaveBeenCalledWith({ type: "offer", sdp: "OFFER" });
  });

  it("sends the peer's signals to the room", async () => {
    const { peer } = await start();

    peer.options.send({ type: "answer", sdp: "ANSWER" });

    expect(socket().sent()).toEqual([{ type: "answer", sdp: "ANSWER" }]);
  });

  it("reports the caller's video", async () => {
    const { peer } = await start();
    const remote = new MediaStream();

    peer.options.onRemoteStream(remote);

    expect(events).toEqual([{ type: "remote", camera, remote }]);
  });

  it("reports the call's media status", async () => {
    const { peer } = await start();

    peer.options.onConnectionState?.("connected");
    peer.options.onConnectionState?.("failed");

    expect(events).toEqual([
      { type: "media", state: "connected" },
      { type: "media", state: "interrupted" },
    ]);
  });

  it.each([
    [{ type: "hangup" }, "The call has ended."],
    [{ type: "timeout" }, "No calls just now."],
  ])("goes back to idle on %o", async (message, reason) => {
    const { peer } = await start();
    socket().receive({ type: "welcome", resumed: false });

    socket().receive(message);
    socket().dispatchEvent(new CloseEvent("close", { code: 4000 })); // the room then disconnects us

    expect(peer.close).toHaveBeenCalled();
    expect(camera.stopped()).toBe(true);
    expect(events.at(-1)).toEqual({ type: "ended", reason });
    expect(sockets).toHaveLength(1);
  });

  it("ends without connecting if the camera can't start", async () => {
    deps.getCamera = () => Promise.reject(new Error("denied"));

    receiverStarter(deps)((event) => events.push(event));

    await vi.waitFor(() => {
      expect(events).toEqual([{ type: "ended", reason: "Couldn't start the camera." }]);
    });
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it("leave() disconnects quietly and doesn't reconnect", async () => {
    const { session } = await start();

    session.leave();

    expect(socket().close).toHaveBeenCalled();
    expect(camera.stopped()).toBe(true);
    expect(events).toEqual([{ type: "ended" }]);
  });

  describe("when the connection drops", () => {
    it("reports reconnecting, without ending the call", async () => {
      const peer = await inCall();

      socket().dispatchEvent(new CloseEvent("close", { code: 1006 }));

      expect(events.at(-1)).toEqual({ type: "connection", state: "reconnecting" });
      expect(peer.close).not.toHaveBeenCalled();
      expect(camera.stopped()).toBe(false);
    });

    it("carries on the call if the room kept its place", async () => {
      const peer = await inCall();
      dropAndReconnect();

      socket().receive({ type: "welcome", resumed: true });

      expect(peer.close).not.toHaveBeenCalled();
      expect(events.at(-1)).toEqual({ type: "connection", state: "connected" });
    });

    it("ends the call if the room didn't keep its place", async () => {
      await inCall();
      dropAndReconnect();

      socket().receive({ type: "welcome", resumed: false });

      expect(camera.stopped()).toBe(true);
      expect(events.at(-1)).toEqual({ type: "ended", reason: "The call has ended." });
    });

    it("keeps waiting if it wasn't in a call", async () => {
      await start();
      socket().receive({ type: "welcome", resumed: false });
      dropAndReconnect();

      socket().receive({ type: "welcome", resumed: false });

      expect(camera.stopped()).toBe(false);
      expect(events.filter((e) => e.type === "waiting")).toHaveLength(1);
    });

    it("ends if the room closes the connection for good (opened elsewhere)", async () => {
      await inCall();

      socket().dispatchEvent(new CloseEvent("close", { code: 4000 }));

      expect(camera.stopped()).toBe(true);
      expect(events.at(-1)).toEqual({
        type: "ended",
        reason: "This screen was opened somewhere else.",
      });
    });
  });
});
