import type { IceServer } from "../shared/ice";
import type { PeerFactory } from "./peer";
import { onMessage, socketPeer, stopCamera, type RoomSocket } from "./signalling";

export interface ReceiverDeps {
  getCamera: () => Promise<MediaStream>;
  getIceServers: () => Promise<IceServer[]>;
  connect: () => RoomSocket;
  createPeer: PeerFactory;
}

export type ReceiverEvent =
  | { type: "waiting"; camera: MediaStream }
  | { type: "remote"; camera: MediaStream; remote: MediaStream }
  | { type: "ended"; reason?: string };

export interface ReceiverSession {
  /** Leaves the room, which makes the receiver unavailable. */
  leave: () => void;
}

export type StartReceiver = (onEvent: (event: ReceiverEvent) => void) => ReceiverSession;

/**
 * The receiver's session: turn on the camera and join the room, which makes the
 * receiver available. An incoming call is answered automatically. When it ends,
 * or nobody calls in time, the session ends and the receiver goes back to idle.
 */
export function receiverStarter(deps: ReceiverDeps): StartReceiver {
  return (onEvent) => {
    let ended = false;
    let teardown = (): void => undefined;

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

      const socket = deps.connect();
      const peer = socketPeer(deps.createPeer, socket, camera, iceServers, (remote) => {
        onEvent({ type: "remote", camera, remote });
      });

      teardown = () => {
        peer.close();
        stopCamera(camera);
        socket.close();
      };

      socket.addEventListener("open", () => {
        onEvent({ type: "waiting", camera });
      });
      onMessage(socket, (message) => {
        switch (message.type) {
          case "offer":
          case "answer":
          case "candidate":
            peer.handle(message).catch(console.error);
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
      });
      // Reconnecting comes later (step 23); for now losing the room ends the session.
      socket.addEventListener("close", () => {
        end("Lost connection.");
      });
    };

    void run();
    return {
      leave: () => {
        end();
      },
    };
  };
}
