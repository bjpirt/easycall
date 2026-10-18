import type { PeerFactory } from "./peer";
import { onMessage, socketPeer, stopCamera, type RoomSocket } from "./signalling";

export interface ReceiverDeps {
  getCamera: () => Promise<MediaStream>;
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
 * receiver available. Incoming calls are answered automatically, and after each
 * call it waits for the next one.
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
      let camera: MediaStream;
      try {
        camera = await deps.getCamera();
      } catch {
        end("Couldn't start the camera.");
        return;
      }
      if (ended) {
        stopCamera(camera); // left while the camera was starting
        return;
      }

      const socket = deps.connect();
      const newPeer = () =>
        socketPeer(deps.createPeer, socket, camera, (remote) => {
          onEvent({ type: "remote", camera, remote });
        });
      let peer = newPeer();

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
            // The call is over: get ready for the next caller.
            peer.close();
            peer = newPeer();
            onEvent({ type: "waiting", camera });
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
