import { parseSignal, type Signal } from "../shared/protocol";

/** The parts of a WebSocket the views use (so tests can pass a fake). */
export type RoomSocket = Pick<WebSocket, "addEventListener" | "close" | "send">;

export function sendSignal(socket: RoomSocket, signal: Signal): void {
  socket.send(JSON.stringify(signal));
}

/** Calls `handler` for each valid signal received; anything else is ignored. */
export function onSignal(socket: RoomSocket, handler: (signal: Signal) => void): void {
  socket.addEventListener("message", (event: MessageEvent) => {
    const signal = parseSignal(event.data);
    if (signal) handler(signal);
  });
}
