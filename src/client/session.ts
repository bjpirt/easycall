import type { Role } from "../shared/roles";
import type { PeerFactory } from "./peer";
import { onSignal, sendSignal, type RoomSocket } from "./signalling";

export interface SessionDeps {
  getCamera: () => Promise<MediaStream>;
  connect: (role: Role) => RoomSocket;
  createPeer: PeerFactory;
}

export type SessionEvent =
  | { type: "connected"; camera: MediaStream }
  | { type: "remote"; camera: MediaStream; remote: MediaStream }
  | { type: "ended"; reason: string };

export type StartSession = (onEvent: (event: SessionEvent) => void) => Promise<void>;

/**
 * Turns on the camera, joins the room and sets up the peer connection. The
 * caller starts the call as soon as it's connected; the receiver answers
 * whatever offer arrives. Everything is torn down when the room connection drops.
 */
export function sessionStarter(role: Role, deps: SessionDeps): StartSession {
  return async (onEvent) => {
    let camera: MediaStream;
    try {
      camera = await deps.getCamera();
    } catch {
      onEvent({ type: "ended", reason: "Couldn't start the camera." });
      return;
    }

    const socket = deps.connect(role);
    const peer = deps.createPeer({
      localStream: camera,
      send: (signal) => {
        sendSignal(socket, signal);
      },
      onRemoteStream: (remote) => {
        onEvent({ type: "remote", camera, remote });
      },
    });

    socket.addEventListener("open", () => {
      onEvent({ type: "connected", camera });
      if (role === "caller") peer.call().catch(console.error);
    });
    onSignal(socket, (signal) => {
      peer.handle(signal).catch(console.error);
    });
    // Reconnecting comes later (step 23); for now losing the room ends the session.
    socket.addEventListener("close", () => {
      peer.close();
      for (const track of camera.getTracks()) track.stop();
      onEvent({ type: "ended", reason: "Lost connection." });
    });
  };
}
