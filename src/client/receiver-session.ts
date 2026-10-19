import { mediaTracker, type MediaState } from "./call-status";
import type { Peer } from "./peer";
import { openRoom } from "./room-connection";
import { cameraFailed, startMedia, stopCamera, type SessionDeps } from "./sessions";

export type ReceiverEvent =
  | { type: "waiting"; camera: MediaStream }
  /** Who's calling, as a call starts. */
  | { type: "incoming"; name: string }
  | { type: "remote"; camera: MediaStream; remote: MediaStream }
  /** The call's media connection (see `MediaState`). */
  | { type: "media"; state: MediaState }
  /** The session is over, and the receiver is back to idle; `reason` says why, if worth saying. */
  | { type: "ended"; reason?: string }
  /** The room connection: `reconnecting` after a drop, `connected` once back. */
  | { type: "connection"; state: "connected" | "reconnecting" };

export interface ReceiverSession {
  /** Leaves the room on purpose (staff tapped End Call), so the receiver is unavailable straight away. */
  leave: () => void;
}

/**
 * The receiver's session, from staff tapping Join Call until it's idle again:
 * turn on the camera and join the room, which makes the receiver available.
 * An incoming call is answered automatically. A dropped connection reconnects
 * by itself (the room holds the receiver's place, so a call carries on). When
 * the call ends, or nobody calls in time, the session ends.
 */
export function startReceiver(
  deps: SessionDeps,
  onEvent: (event: ReceiverEvent) => void,
): ReceiverSession {
  let ended = false;
  /** Set once connected: leaving tells the room, and ending tidies up. */
  let live: { goodbye: () => void; teardown: () => void } | undefined;

  const end = (reason?: string): void => {
    if (ended) return;
    ended = true;
    live?.teardown();
    onEvent(reason === undefined ? { type: "ended" } : { type: "ended", reason });
  };

  const run = async (): Promise<void> => {
    const media = await startMedia(deps);
    if (!media) {
      end(cameraFailed);
      return;
    }
    const { camera, iceServers } = media;
    if (ended) {
      stopCamera(camera); // left while we were getting ready
      return;
    }

    let inCall = false;
    let welcomed = false;
    /** The call we're answering, once one has started. */
    let call: string | undefined;
    const onConnectionState = mediaTracker((state) => {
      onEvent({ type: "media", state });
    });
    const newPeer = (): Peer =>
      deps.createPeer({
        localStream: camera,
        iceServers,
        send: (signal) => {
          room.send(signal);
        },
        onRemoteStream: (remote) => {
          inCall = true;
          onEvent({ type: "remote", camera, remote });
        },
        onConnectionState,
      });
    let peer = newPeer();

    const room = openRoom(deps.connect, {
      onMessage: (message) => {
        switch (message.type) {
          case "welcome":
            deps.onVersion?.(message.version);
            onEvent({ type: "connection", state: "connected" });
            // Back after a drop, but the room didn't keep our place: the call is over.
            if (inCall && !message.resumed) end("The call has ended.");
            else if (!welcomed) onEvent({ type: "waiting", camera });
            welcomed = true;
            return;
          case "offer":
          case "answer":
          case "candidate":
            peer.handle(message).catch(console.error);
            return;
          case "incoming":
            // A different call: the caller rejoined from a new page, so start afresh.
            if (call !== undefined && call !== message.call) {
              peer.close();
              peer = newPeer();
            }
            call = message.call;
            onEvent({ type: "incoming", name: message.name });
            return;
          case "hangup":
            end("The call has ended.");
            return;
          case "timeout":
            end("No calls just now.");
            return;
          default:
            return;
        }
      },
      onReconnecting: () => {
        onEvent({ type: "connection", state: "reconnecting" });
      },
      onClosed: () => {
        end("This screen was opened somewhere else.");
      },
    });

    live = {
      goodbye: () => {
        room.send({ type: "hangup" });
      },
      teardown: () => {
        peer.close();
        stopCamera(camera);
        room.close();
      },
    };
  };

  void run();
  return {
    leave: () => {
      live?.goodbye();
      end();
    },
  };
}
