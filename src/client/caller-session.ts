import type { Status } from "../shared/protocol";
import { mediaTracker, type MediaState } from "./call-status";
import type { Peer } from "./peer";
import { openRoom } from "./room-connection";
import { cameraFailed, startMedia, stopCamera, type SessionDeps } from "./sessions";

export type CallerEvent =
  /**
   * The receiver's availability; `caller` is who's in the call, if anyone, and
   * `rejoin` means it's our call, dropped, and we can join it again.
   */
  | { type: "status"; status: Status; caller?: string; rejoin?: true }
  | { type: "calling"; camera: MediaStream }
  | { type: "remote"; camera: MediaStream; remote: MediaStream }
  /** The call's media connection (see `MediaState`). */
  | { type: "media"; state: MediaState }
  /** The call is over (or never started); `reason` says why, if worth saying. */
  | { type: "ended"; reason?: string }
  /** The room connection: `reconnecting` after a drop, `connected` once back, `closed` for good. */
  | { type: "connection"; state: "connected" | "reconnecting" | "closed" };

export interface CallerSession {
  join: () => void;
  hangUp: () => void;
}

interface Call {
  camera: MediaStream;
  peer: Peer;
  /** Follows the media connection, reporting `media` events. */
  trackMedia: (state: RTCPeerConnectionState) => MediaState | undefined;
  /** The media connection as last reported. */
  media: MediaState;
}

/** How long a briefly `disconnected` call gets to recover by itself before we restart it. */
export const restartAfterMs = 3000;

/** How long a call can go without a working media connection before we give up on it. */
export const giveUpAfterMs = 30_000;

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
  deps: SessionDeps,
  onEvent: (event: CallerEvent) => void,
): CallerSession {
  let connected = false;
  let status: Status = "unavailable";
  let call: Call | undefined;
  /** Set while the camera is starting, so a hang-up can cancel the join. */
  let pending: { cancelled: boolean } | undefined;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let giveUpTimer: ReturnType<typeof setTimeout> | undefined;

  const giveUp = (): void => {
    room.send({ type: "hangup" });
    endCall(
      call?.media === "interrupted"
        ? "The call was cut off."
        : "Couldn't connect. Please try again.",
    );
  };

  /** Gives the call `giveUpAfterMs` to get media flowing (again), unless already counting. */
  const startGiveUpTimer = (): void => {
    giveUpTimer ??= setTimeout(giveUp, giveUpAfterMs);
  };

  const restart = (): void => {
    clearTimeout(restartTimer);
    call?.peer.restart().catch(console.error);
  };

  const onConnectionState = (state: RTCPeerConnectionState): void => {
    clearTimeout(restartTimer);
    if (state === "failed") restart();
    else if (state === "disconnected") restartTimer = setTimeout(restart, restartAfterMs);

    if (!call) return;
    const media = call.trackMedia(state);
    if (media === "connected") {
      clearTimeout(giveUpTimer);
      giveUpTimer = undefined;
    } else if (media) {
      startGiveUpTimer();
    }
  };

  const endCall = (reason?: string): void => {
    clearTimeout(restartTimer);
    clearTimeout(giveUpTimer);
    giveUpTimer = undefined;
    if (!call) return;
    call.peer.close();
    stopCamera(call.camera);
    call = undefined;
    onEvent(reason === undefined ? { type: "ended" } : { type: "ended", reason });
  };

  const room = openRoom(deps.connect, {
    onMessage: (message) => {
      switch (message.type) {
        case "welcome":
          deps.onVersion?.(message.version);
          connected = true;
          onEvent({ type: "connection", state: "connected" });
          // Back after a drop. If the room kept our place, the network may have
          // changed, so find the call a fresh path; if not, the call is over.
          if (message.resumed) restart();
          else endCall("The call has ended.");
          return;
        case "status":
          status = message.status;
          onEvent(message);
          return;
        case "joined":
          call?.peer.call().catch(console.error);
          startGiveUpTimer();
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
    const media = await startMedia(deps);
    pending = undefined;
    if (!media) {
      onEvent({ type: "ended", reason: cameraFailed });
      return;
    }
    const { camera, iceServers } = media;
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
    const trackMedia = mediaTracker((state) => {
      if (call) call.media = state;
      onEvent({ type: "media", state });
    });
    call = { camera, peer, trackMedia, media: "connecting" };
    onEvent({ type: "calling", camera });
    room.send({ type: "join" });
  };

  return {
    join: () => void join(),
    hangUp: () => {
      if (pending) {
        pending.cancelled = true;
        pending = undefined;
        onEvent({ type: "ended" });
        return;
      }
      if (call) room.send({ type: "hangup" });
      endCall();
    },
  };
}
