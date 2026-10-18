import type { Role } from "../shared/roles";
import type { Peer, PeerFactory } from "./peer";
import { onMessage, sendMessage, type RoomSocket } from "./signalling";

export interface SessionDeps {
  getCamera: () => Promise<MediaStream>;
  connect: (role: Role) => RoomSocket;
  createPeer: PeerFactory;
}

export type SessionEvent =
  | { type: "connected"; camera: MediaStream }
  | { type: "remote"; camera: MediaStream; remote: MediaStream }
  | { type: "ended"; reason?: string };

export interface Session {
  /** Ends the call deliberately: tells the other side, then tears everything down. */
  hangUp: () => void;
}

export type StartSession = (onEvent: (event: SessionEvent) => void) => Session;

/**
 * Turns on the camera, joins the room and sets up the peer connection. The
 * caller starts the call as soon as it's connected; the receiver answers
 * whatever offer arrives, and after a hang-up waits for the next caller.
 */
export function sessionStarter(role: Role, deps: SessionDeps): StartSession {
  return (onEvent) => {
    let ended = false;
    let teardown = (): void => undefined;
    let hangUp = (): void => {
      end({ type: "ended" });
    };

    const end = (event: SessionEvent & { type: "ended" }): void => {
      if (ended) return;
      ended = true;
      teardown();
      onEvent(event);
    };

    const run = async (): Promise<void> => {
      let camera: MediaStream;
      try {
        camera = await deps.getCamera();
      } catch {
        end({ type: "ended", reason: "Couldn't start the camera." });
        return;
      }
      if (ended) {
        stop(camera); // hung up while the camera was starting
        return;
      }

      const socket = deps.connect(role);
      let open = false;
      const newPeer = (): Peer =>
        deps.createPeer({
          localStream: camera,
          send: (signal) => {
            sendMessage(socket, signal);
          },
          onRemoteStream: (remote) => {
            onEvent({ type: "remote", camera, remote });
          },
        });
      let peer = newPeer();

      teardown = () => {
        peer.close();
        stop(camera);
        socket.close();
      };
      hangUp = () => {
        if (open) sendMessage(socket, { type: "hangup" });
        end({ type: "ended" });
      };

      socket.addEventListener("open", () => {
        open = true;
        onEvent({ type: "connected", camera });
        if (role === "caller") peer.call().catch(console.error);
      });
      onMessage(socket, (message) => {
        if (message.type !== "hangup") {
          peer.handle(message).catch(console.error);
        } else if (role === "receiver") {
          // The caller hung up: get ready for the next one.
          peer.close();
          peer = newPeer();
          onEvent({ type: "connected", camera });
        } else {
          end({ type: "ended", reason: "The call has ended." });
        }
      });
      // Reconnecting comes later (step 23); for now losing the room ends the session.
      socket.addEventListener("close", () => {
        end({ type: "ended", reason: "Lost connection." });
      });
    };

    void run();
    return {
      hangUp: () => {
        hangUp();
      },
    };
  };
}

function stop(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
