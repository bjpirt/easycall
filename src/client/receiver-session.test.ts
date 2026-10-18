import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  receiverStarter,
  type ReceiverDeps,
  type ReceiverEvent,
  type ReceiverSession,
} from "./receiver-session";
import { FakeSocket, fakeCamera, fakePeer, type FakeCamera, type FakePeer } from "./test-fakes";

let socket: FakeSocket;
let camera: FakeCamera;
let peers: FakePeer[];
let deps: ReceiverDeps;
let events: ReceiverEvent[];

beforeEach(() => {
  socket = new FakeSocket();
  camera = fakeCamera();
  peers = [];
  events = [];
  deps = {
    getCamera: vi.fn(() => Promise.resolve(camera)),
    connect: vi.fn(() => socket),
    createPeer: (options) => {
      const peer = fakePeer(options);
      peers.push(peer);
      return peer;
    },
  };
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

describe("receiver session", () => {
  it("waits once the room connection opens", async () => {
    await start();
    expect(events).toEqual([]);

    socket.dispatchEvent(new Event("open"));

    expect(events).toEqual([{ type: "waiting", camera }]);
  });

  it("never starts a call itself", async () => {
    const { peer } = await start();

    socket.dispatchEvent(new Event("open"));

    expect(peer.call).not.toHaveBeenCalled();
  });

  it("passes signals to the peer and ignores everything else", async () => {
    const { peer } = await start();

    socket.receive({ type: "offer", sdp: "OFFER" });
    socket.receive({ type: "status", status: "available" });
    socket.receive({ type: "nonsense" });

    expect(peer.handle).toHaveBeenCalledTimes(1);
    expect(peer.handle).toHaveBeenCalledWith({ type: "offer", sdp: "OFFER" });
  });

  it("sends the peer's signals to the room", async () => {
    const { peer } = await start();

    peer.options.send({ type: "answer", sdp: "ANSWER" });

    expect(socket.sent()).toEqual([{ type: "answer", sdp: "ANSWER" }]);
  });

  it("reports the caller's video", async () => {
    const { peer } = await start();
    const remote = new MediaStream();

    peer.options.onRemoteStream(remote);

    expect(events).toEqual([{ type: "remote", camera, remote }]);
  });

  it("goes back to waiting with a fresh peer when the call ends", async () => {
    const { peer } = await start();
    socket.dispatchEvent(new Event("open"));
    events.length = 0;

    socket.receive({ type: "hangup" });

    expect(peer.close).toHaveBeenCalled();
    expect(camera.stopped()).toBe(false);
    expect(events).toEqual([{ type: "waiting", camera }]);
    socket.receive({ type: "offer", sdp: "NEXT" });
    expect(peers[1]?.handle).toHaveBeenCalledWith({ type: "offer", sdp: "NEXT" });
  });

  it("ends without connecting if the camera can't start", async () => {
    deps.getCamera = () => Promise.reject(new Error("denied"));

    receiverStarter(deps)((event) => events.push(event));

    await vi.waitFor(() => {
      expect(events).toEqual([{ type: "ended", reason: "Couldn't start the camera." }]);
    });
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it("tears everything down when the room connection drops", async () => {
    const { peer } = await start();

    socket.dispatchEvent(new Event("close"));

    expect(peer.close).toHaveBeenCalled();
    expect(camera.stopped()).toBe(true);
    expect(events).toEqual([{ type: "ended", reason: "Lost connection." }]);
  });

  it("leave() disconnects quietly", async () => {
    const { session } = await start();

    session.leave();
    socket.dispatchEvent(new Event("close"));

    expect(socket.close).toHaveBeenCalled();
    expect(camera.stopped()).toBe(true);
    expect(events).toEqual([{ type: "ended" }]);
  });
});
