import type { IceServer } from "../shared/ice";
import type { Signal } from "../shared/protocol";

export interface PeerOptions {
  localStream: MediaStream;
  /** STUN/TURN servers for this call (TURN relays media when a direct connection fails). */
  iceServers: IceServer[];
  send: (signal: Signal) => void;
  onRemoteStream: (stream: MediaStream) => void;
  /** The media connection's state: `connected`, `disconnected` (maybe briefly), `failed`, … */
  onConnectionState?: (state: RTCPeerConnectionState) => void;
}

export interface Peer {
  /** Caller side: start the call by sending an offer. */
  call: () => Promise<void>;
  /** Caller side: find a new network path for a call whose connection broke (ICE restart). */
  restart: () => Promise<void>;
  /** Handle a signal from the other side. Signals are processed strictly in order. */
  handle: (signal: Signal) => Promise<void>;
  close: () => void;
}

export type PeerFactory = (options: PeerOptions) => Peer;

/**
 * Wraps an RTCPeerConnection. The caller always offers and the receiver always
 * answers, so there's no offer collision to handle.
 */
export function createPeer(
  { localStream, iceServers, send, onRemoteStream, onConnectionState }: PeerOptions,
  connection: RTCPeerConnection = new RTCPeerConnection({ iceServers }),
): Peer {
  for (const track of localStream.getTracks()) connection.addTrack(track, localStream);

  connection.addEventListener("icecandidate", ({ candidate }) => {
    if (candidate) {
      const { sdpMid, sdpMLineIndex } = candidate;
      send({
        type: "candidate",
        candidate: { candidate: candidate.candidate, sdpMid, sdpMLineIndex },
      });
    }
  });
  connection.addEventListener("connectionstatechange", () => {
    onConnectionState?.(connection.connectionState);
  });
  connection.addEventListener("track", ({ streams }) => {
    const [stream] = streams;
    if (stream) onRemoteStream(stream);
  });

  const process = async (signal: Signal): Promise<void> => {
    switch (signal.type) {
      case "offer": {
        await connection.setRemoteDescription({ type: "offer", sdp: signal.sdp });
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);
        send({ type: "answer", sdp: answer.sdp ?? "" });
        return;
      }
      case "answer":
        await connection.setRemoteDescription({ type: "answer", sdp: signal.sdp });
        return;
      case "candidate":
        await connection.addIceCandidate(signal.candidate);
        return;
    }
  };

  // Candidates can arrive while the offer is still being applied, so queue.
  let queue = Promise.resolve();

  const offer = async (options?: RTCOfferOptions): Promise<void> => {
    const description = await connection.createOffer(options);
    await connection.setLocalDescription(description);
    send({ type: "offer", sdp: description.sdp ?? "" });
  };

  return {
    call: () => offer(),
    // The receiver answers a restart offer like any other.
    restart: () => offer({ iceRestart: true }),
    handle: (signal) => {
      const next = queue.then(() => process(signal));
      queue = next.catch(() => undefined); // one bad signal mustn't block the rest
      return next;
    },
    close: () => {
      connection.close();
    },
  };
}
