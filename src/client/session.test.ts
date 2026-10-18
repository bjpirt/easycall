import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Role } from "../shared/roles";
import { sessionStarter, type Session, type SessionDeps, type SessionEvent } from "./session";
import { FakeSocket, fakeCamera, fakePeer, type FakeCamera, type FakePeer } from "./test-fakes";

let socket: FakeSocket;
let camera: FakeCamera;
let peers: FakePeer[];
let deps: SessionDeps;
let events: SessionEvent[];

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

/** Starts a session and waits until it has connected to the room (but not opened). */
async function start(role: Role): Promise<{ session: Session; peer: FakePeer }> {
  const session = sessionStarter(role, deps)((event) => events.push(event));
  await vi.waitFor(() => {
    expect(peers).toHaveLength(1);
  });
  const [peer] = peers;
  if (!peer) throw new Error("No peer created");
  return { session, peer };
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
    const { peer } = await start("caller");

    socket.dispatchEvent(new Event("open"));

    expect(peer.call).toHaveBeenCalled();
  });

  it("the receiver doesn't start a call", async () => {
    const { peer } = await start("receiver");

    socket.dispatchEvent(new Event("open"));

    expect(peer.call).not.toHaveBeenCalled();
  });

  it("passes signals from the room to the peer", async () => {
    const { peer } = await start("receiver");

    socket.receive({ type: "offer", sdp: "OFFER" });
    socket.receive({ type: "nonsense" });

    expect(peer.handle).toHaveBeenCalledTimes(1);
    expect(peer.handle).toHaveBeenCalledWith({ type: "offer", sdp: "OFFER" });
  });

  it("sends the peer's signals to the room", async () => {
    const { peer } = await start("receiver");

    peer.options.send({ type: "answer", sdp: "ANSWER" });

    expect(socket.sent()).toEqual([{ type: "answer", sdp: "ANSWER" }]);
  });

  it("reports the remote stream", async () => {
    const { peer } = await start("caller");
    const remote = new MediaStream();

    peer.options.onRemoteStream(remote);

    expect(events).toEqual([{ type: "remote", camera, remote }]);
  });

  it("ends without connecting if the camera can't start", async () => {
    deps.getCamera = () => Promise.reject(new Error("denied"));

    sessionStarter("caller", deps)((event) => events.push(event));

    await vi.waitFor(() => {
      expect(events).toEqual([{ type: "ended", reason: "Couldn't start the camera." }]);
    });
    expect(deps.connect).not.toHaveBeenCalled();
  });

  it("tears everything down when the room connection drops", async () => {
    const { peer } = await start("caller");

    socket.dispatchEvent(new Event("close"));

    expect(peer.close).toHaveBeenCalled();
    expect(camera.stopped()).toBe(true);
    expect(events).toEqual([{ type: "ended", reason: "Lost connection." }]);
  });

  describe("hanging up", () => {
    it("tells the other side, tears down and ends without an error", async () => {
      const { session, peer } = await start("caller");
      socket.dispatchEvent(new Event("open"));
      events.length = 0;

      session.hangUp();
      socket.dispatchEvent(new Event("close")); // the close we caused isn't a lost connection

      expect(socket.sent()).toEqual([{ type: "hangup" }]);
      expect(peer.close).toHaveBeenCalled();
      expect(camera.stopped()).toBe(true);
      expect(socket.close).toHaveBeenCalled();
      expect(events).toEqual([{ type: "ended" }]);
    });

    it("doesn't send anything if the room connection isn't open yet", async () => {
      const { session } = await start("caller");

      session.hangUp();

      expect(socket.send).not.toHaveBeenCalled();
      expect(events).toEqual([{ type: "ended" }]);
    });

    it("while the camera is starting, turns it off and never connects", async () => {
      let resolveCamera: (camera: MediaStream) => void = () => undefined;
      deps.getCamera = () => new Promise((resolve) => (resolveCamera = resolve));
      const session = sessionStarter("caller", deps)((event) => events.push(event));

      session.hangUp();
      resolveCamera(camera);

      await vi.waitFor(() => {
        expect(camera.stopped()).toBe(true);
      });
      expect(deps.connect).not.toHaveBeenCalled();
      expect(events).toEqual([{ type: "ended" }]);
    });

    it("the receiver goes back to waiting with a fresh peer when the caller hangs up", async () => {
      const { peer } = await start("receiver");
      socket.dispatchEvent(new Event("open"));
      events.length = 0;

      socket.receive({ type: "hangup" });

      expect(peer.close).toHaveBeenCalled();
      expect(peers).toHaveLength(2);
      expect(peer.handle).not.toHaveBeenCalled();
      expect(camera.stopped()).toBe(false);
      expect(events).toEqual([{ type: "connected", camera }]);

      socket.receive({ type: "offer", sdp: "NEXT" });
      expect(peers[1]?.handle).toHaveBeenCalledWith({ type: "offer", sdp: "NEXT" });
    });

    it("the caller's call ends when the receiver hangs up", async () => {
      await start("caller");
      socket.dispatchEvent(new Event("open"));
      events.length = 0;

      socket.receive({ type: "hangup" });

      expect(camera.stopped()).toBe(true);
      expect(events).toEqual([{ type: "ended", reason: "The call has ended." }]);
    });
  });
});
