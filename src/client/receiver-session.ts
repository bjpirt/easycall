import type { IceServer } from "../shared/ice";
import { mediaState, type MediaState } from "./call-status";
import type { Peer, PeerFactory } from "./peer";
import { openRoom, type RoomConnection } from "./room-connection";
import { stopCamera, type RoomSocket } from "./signalling";

export interface ReceiverDeps {
  getCamera: () => Promise<MediaStream>;
  getIceServers: () => Promise<IceServer[]>;
  connect: () => RoomSocket;
  createPeer: PeerFactory;
  /** Told the app version the room is running, so an out-of-date page can update. */
  onVersion?: (version: string) => void;
}

export type ReceiverEvent =
  | { type: "waiting"; camera: MediaStream }
  /** Who's calling, as a call starts. */
  | { type: "incoming"; name: string }
  | { type: "remote"; camera: MediaStream; remote: MediaStream }
  /** The call's media connection (see `MediaState`). */
  | { type: "media"; state: MediaState }
  | { type: "ended"; reason?: string }
  /** The room connection: `reconnecting` after a drop, `connected` once back. */
  | { type: "connection"; state: "connected" | "reconnecting" };

export interface ReceiverSession {
  /** Leaves the room on purpose (staff tapped End Call), so the receiver is unavailable straight away. */
  leave: () => void;
}

export type StartReceiver = (onEvent: (event: ReceiverEvent) => void) => ReceiverSession;

/**
 * The receiver's session: turn on the camera and join the room, which makes the
 * receiver available. An incoming call is answered automatically. A dropped
 * connection reconnects by itself (the room holds the receiver's place, so a
 * call carries on). When the call ends, or nobody calls in time, the session
 * ends and the receiver goes back to idle.
 */
export function receiverStarter(deps: ReceiverDeps): StartReceiver {
  return (onEvent) => {
    let ended = false;
    let teardown = (): void => undefined;
    /** Tells the room we're leaving on purpose, once connected. */
    let sayGoodbye = (): void => undefined;

    const end = (reason?: string): void => {
      if (ended) return;
      ended = true;
      teardown();
      onEvent(reason === undefined ? { type: "ended" } : { type: "ended", reason });
    };

    const run = async (): Promise<void> => {
      const ice = deps.getIceServers(); // in parallel with the camera
      let camera: MediaStream;
      try {
        camera = await deps.getCamera();
      } catch {
        end("Couldn't start the camera.");
        return;
      }
      const iceServers = await ice;
      if (ended) {
        stopCamera(camera); // left while we were getting ready
        return;
      }

      let inCall = false;
      let welcomed = false;
      let connectedBefore = false;
      /** The call we're answering, once one has started. */
      let call: string | undefined;
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
          onConnectionState: (state) => {
            const media = mediaState(state, connectedBefore);
            if (media === "connected") connectedBefore = true;
            if (media) onEvent({ type: "media", state: media });
          },
        });
      let peer = newPeer();
      const room: RoomConnection = openRoom(deps.connect, {
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

      sayGoodbye = () => {
        room.send({ type: "hangup" });
      };
      teardown = () => {
        peer.close();
        stopCamera(camera);
        room.close();
      };
    };

    void run();
    return {
      leave: () => {
        sayGoodbye();
        end();
      },
    };
  };
}
