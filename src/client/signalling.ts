import { parseMessage, type Message } from "../shared/protocol";
import type { Peer, PeerFactory } from "./peer";

/** The parts of a WebSocket the client uses (so tests can pass a fake). */
export type RoomSocket = Pick<WebSocket, "addEventListener" | "close" | "send">;

export function sendMessage(socket: RoomSocket, message: Message): void {
  socket.send(JSON.stringify(message));
}

/** Calls `handler` for each valid message received; anything else is ignored. */
export function onMessage(socket: RoomSocket, handler: (message: Message) => void): void {
  socket.addEventListener("message", (event: MessageEvent) => {
    const message = parseMessage(event.data);
    if (message) handler(message);
  });
}

/** A peer whose signals go out over the room socket. */
export function socketPeer(
  createPeer: PeerFactory,
  socket: RoomSocket,
  camera: MediaStream,
  onRemoteStream: (remote: MediaStream) => void,
): Peer {
  return createPeer({
    localStream: camera,
    send: (signal) => {
      sendMessage(socket, signal);
    },
    onRemoteStream,
  });
}

export function stopCamera(camera: MediaStream): void {
  for (const track of camera.getTracks()) track.stop();
}
