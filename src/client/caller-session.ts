import type { IceServer } from "../shared/ice";
import type { Status } from "../shared/protocol";
import type { Peer, PeerFactory } from "./peer";
import { openRoom } from "./room-connection";
import { stopCamera, type RoomSocket } from "./signalling";

export interface CallerDeps {
  getCamera: () => Promise<MediaStream>;
  getIceServers: () => Promise<IceServer[]>;
  connect: () => RoomSocket;
  createPeer: PeerFactory;
}

export type CallerEvent =
  | { type: "status"; status: Status }
  | { type: "calling"; camera: MediaStream }
  | { type: "remote"; camera: MediaStream; remote: MediaStream }
  | { type: "call-ended"; reason?: string }
  /** The room connection: `reconnecting` after a drop, `connected` once back, `closed` for good. */
  | { type: "connection"; state: "connected" | "reconnecting" | "closed" };

export interface CallerSession {
  join: () => void;
  hangUp: () => void;
}

interface Call {
  camera: MediaStream;
  peer: Peer;
}

/** How long a briefly `disconnected` call gets to recover by itself before we restart it. */
export const restartAfterMs = 3000;

/**
 * The caller's connection to the room, open for as long as the page is (and
 * reconnecting by itself after a drop). It reports the receiver's availability;
 * `join` turns on the camera and asks the room for the call, and the offer goes
 * out once the room says we're in. A dropped connection doesn't end the call:
 * the room holds our place, and media keeps flowing between the devices. If
 * the media connection itself breaks (e.g. a network change), we find it a new
 * path with an ICE restart: the caller makes all offers, so the caller recovers.
 */
export function connectCaller(
  deps: CallerDeps,
  onEvent: (event: CallerEvent) => void,
): CallerSession {
  let connected = false;
  let status: Status = "unavailable";
  let call: Call | undefined;
  /** Set while the camera is starting, so a hang-up can cancel the join. */
  let pending: { cancelled: boolean } | undefined;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;

  const restart = (): void => {
    clearTimeout(restartTimer);
    call?.peer.restart().catch(console.error);
  };

  const onConnectionState = (state: RTCPeerConnectionState): void => {
    clearTimeout(restartTimer);
    if (state === "failed") restart();
    else if (state === "disconnected") restartTimer = setTimeout(restart, restartAfterMs);
  };

  const endCall = (reason?: string): void => {
    clearTimeout(restartTimer);
    if (!call) return;
    call.peer.close();
    stopCamera(call.camera);
    call = undefined;
    onEvent(reason === undefined ? { type: "call-ended" } : { type: "call-ended", reason });
  };

  const room = openRoom(deps.connect, {
    onMessage: (message) => {
      switch (message.type) {
        case "welcome":
          connected = true;
          onEvent({ type: "connection", state: "connected" });
          // Back after a drop. If the room kept our place, the network may have
          // changed, so find the call a fresh path; if not, the call is over.
          if (message.resumed) restart();
          else endCall("The call has ended.");
          return;
        case "status":
          status = message.status;
          onEvent({ type: "status", status });
          return;
        case "joined":
          call?.peer.call().catch(console.error);
          return;
        case "refused":
          endCall(
            status === "in-call"
              ? "Someone else is in a call right now."
              : "Not available right now.",
          );
          return;
        case "offer":
        case "answer":
        case "candidate":
          call?.peer.handle(message).catch(console.error);
          return;
        case "hangup":
          endCall("The call has ended.");
          return;
        default:
          return;
      }
    },
    onReconnecting: () => {
      connected = false;
      onEvent({ type: "connection", state: "reconnecting" });
    },
    onClosed: () => {
      connected = false;
      endCall();
      onEvent({ type: "connection", state: "closed" });
    },
  });

  const join = async (): Promise<void> => {
    if (call || pending || !connected) return;
    const attempt = { cancelled: false };
    pending = attempt;
    const ice = deps.getIceServers(); // in parallel with the camera
    let camera: MediaStream;
    try {
      camera = await deps.getCamera();
    } catch {
      pending = undefined;
      onEvent({ type: "call-ended", reason: "Couldn't start the camera." });
      return;
    }
    const iceServers = await ice;
    pending = undefined;
    if (attempt.cancelled) {
      stopCamera(camera); // hung up while the camera was starting
      return;
    }
    const peer = deps.createPeer({
      localStream: camera,
      iceServers,
      send: room.send,
      onRemoteStream: (remote) => {
        onEvent({ type: "remote", camera, remote });
      },
      onConnectionState,
    });
    call = { camera, peer };
    onEvent({ type: "calling", camera });
    room.send({ type: "join" });
  };

  return {
    join: () => void join(),
    hangUp: () => {
      if (pending) {
        pending.cancelled = true;
        pending = undefined;
        onEvent({ type: "call-ended" });
        return;
      }
      if (call) room.send({ type: "hangup" });
      endCall();
    },
  };
}
