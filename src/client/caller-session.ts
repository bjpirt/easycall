import type { Status } from "../shared/protocol";
import type { Peer, PeerFactory } from "./peer";
import { onMessage, sendMessage, socketPeer, stopCamera, type RoomSocket } from "./signalling";

export interface CallerDeps {
  getCamera: () => Promise<MediaStream>;
  connect: () => RoomSocket;
  createPeer: PeerFactory;
}

export type CallerEvent =
  | { type: "status"; status: Status }
  | { type: "calling"; camera: MediaStream }
  | { type: "remote"; camera: MediaStream; remote: MediaStream }
  | { type: "call-ended"; reason?: string }
  | { type: "disconnected" };

export interface CallerSession {
  join: () => void;
  hangUp: () => void;
}

interface Call {
  camera: MediaStream;
  peer: Peer;
}

/**
 * The caller's connection to the room, open for as long as the page is. It
 * reports the receiver's availability; `join` turns on the camera and asks the
 * room for the call, and the offer goes out once the room says we're in.
 */
export function connectCaller(
  deps: CallerDeps,
  onEvent: (event: CallerEvent) => void,
): CallerSession {
  const socket = deps.connect();
  let open = false;
  let call: Call | undefined;
  let status: Status = "unavailable";
  /** Set while the camera is starting, so a hang-up can cancel the join. */
  let pending: { cancelled: boolean } | undefined;

  const endCall = (reason?: string): void => {
    if (!call) return;
    call.peer.close();
    stopCamera(call.camera);
    call = undefined;
    onEvent(reason === undefined ? { type: "call-ended" } : { type: "call-ended", reason });
  };

  socket.addEventListener("open", () => {
    open = true;
  });
  onMessage(socket, (message) => {
    switch (message.type) {
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
  });
  // Reconnecting comes later (step 23).
  socket.addEventListener("close", () => {
    open = false;
    endCall();
    onEvent({ type: "disconnected" });
  });

  const join = async (): Promise<void> => {
    if (call || pending || !open) return;
    const attempt = { cancelled: false };
    pending = attempt;
    let camera: MediaStream;
    try {
      camera = await deps.getCamera();
    } catch {
      pending = undefined;
      onEvent({ type: "call-ended", reason: "Couldn't start the camera." });
      return;
    }
    pending = undefined;
    if (attempt.cancelled) {
      stopCamera(camera); // hung up while the camera was starting
      return;
    }
    const peer = socketPeer(deps.createPeer, socket, camera, (remote) => {
      onEvent({ type: "remote", camera, remote });
    });
    call = { camera, peer };
    onEvent({ type: "calling", camera });
    sendMessage(socket, { type: "join" });
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
      if (open && call) sendMessage(socket, { type: "hangup" });
      endCall();
    },
  };
}
