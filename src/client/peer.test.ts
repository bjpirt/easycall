import { describe, expect, it, vi } from "vitest";
import type { Signal } from "../shared/protocol";
import { createPeer } from "./peer";
import { fakeCamera } from "./test-fakes";

/** A scripted RTCPeerConnection that records the order of calls. */
class FakeConnection extends EventTarget {
  log: string[] = [];
  remoteSet: () => void = () => undefined;
  holdRemote = false;

  addTrack = vi.fn();
  close = vi.fn();
  createOffer = vi.fn(() => Promise.resolve({ type: "offer", sdp: "OFFER" }));
  createAnswer = vi.fn(() => Promise.resolve({ type: "answer", sdp: "ANSWER" }));
  setLocalDescription = vi.fn((d: RTCSessionDescriptionInit) => {
    this.log.push(`local:${d.type}`);
    return Promise.resolve();
  });
  setRemoteDescription = vi.fn((d: RTCSessionDescriptionInit) => {
    this.log.push(`remote:${d.type}`);
    if (!this.holdRemote) return Promise.resolve();
    return new Promise<void>((resolve) => (this.remoteSet = resolve));
  });
  addIceCandidate = vi.fn((c: RTCIceCandidateInit) => {
    this.log.push(`candidate:${c.candidate ?? ""}`);
    return Promise.resolve();
  });
}

function setup() {
  const connection = new FakeConnection();
  const sent: Signal[] = [];
  const onRemoteStream = vi.fn();
  const camera = fakeCamera();
  const peer = createPeer(
    { localStream: camera, iceServers: [], send: (s) => sent.push(s), onRemoteStream },
    connection as unknown as RTCPeerConnection,
  );
  return { connection, sent, onRemoteStream, camera, peer };
}

const candidate = (c: string): Signal => ({
  type: "candidate",
  candidate: { candidate: c, sdpMid: "0", sdpMLineIndex: 0 },
});

describe("createPeer", () => {
  it("adds the local camera tracks", () => {
    const { connection, camera } = setup();

    expect(connection.addTrack).toHaveBeenCalledWith(camera.getTracks()[0], camera);
  });

  it("call() sends an offer", async () => {
    const { connection, sent, peer } = setup();

    await peer.call();

    expect(connection.log).toEqual(["local:offer"]);
    expect(sent).toEqual([{ type: "offer", sdp: "OFFER" }]);
  });

  it("answers an offer", async () => {
    const { connection, sent, peer } = setup();

    await peer.handle({ type: "offer", sdp: "OFFER" });

    expect(connection.log).toEqual(["remote:offer", "local:answer"]);
    expect(sent).toEqual([{ type: "answer", sdp: "ANSWER" }]);
  });

  it("applies an answer", async () => {
    const { connection, peer } = setup();

    await peer.handle({ type: "answer", sdp: "ANSWER" });

    expect(connection.log).toEqual(["remote:answer"]);
  });

  it("waits for the offer to be applied before adding candidates", async () => {
    const { connection, peer } = setup();
    connection.holdRemote = true;

    const offer = peer.handle({ type: "offer", sdp: "OFFER" });
    const added = peer.handle(candidate("c1"));
    await Promise.resolve();
    expect(connection.log).toEqual(["remote:offer"]);

    connection.remoteSet();
    await Promise.all([offer, added]);
    expect(connection.log).toEqual(["remote:offer", "local:answer", "candidate:c1"]);
  });

  it("keeps processing after a signal fails", async () => {
    const { connection, peer } = setup();
    connection.setRemoteDescription.mockRejectedValueOnce(new Error("bad sdp"));

    await expect(peer.handle({ type: "answer", sdp: "BAD" })).rejects.toThrow("bad sdp");
    await peer.handle(candidate("c1"));

    expect(connection.log).toContain("candidate:c1");
  });

  it("sends local ICE candidates", () => {
    const { connection, sent } = setup();

    const event = Object.assign(new Event("icecandidate"), {
      candidate: { candidate: "c1", sdpMid: "0", sdpMLineIndex: 0 },
    });
    connection.dispatchEvent(event);

    expect(sent).toEqual([candidate("c1")]);
  });

  it("reports the remote stream", () => {
    const { connection, onRemoteStream } = setup();
    const remote = new MediaStream();

    connection.dispatchEvent(Object.assign(new Event("track"), { streams: [remote] }));

    expect(onRemoteStream).toHaveBeenCalledWith(remote);
  });

  it("close() closes the connection", () => {
    const { connection, peer } = setup();

    peer.close();

    expect(connection.close).toHaveBeenCalled();
  });
});
