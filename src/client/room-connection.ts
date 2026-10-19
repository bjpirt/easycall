import { parseMessage, type Message } from "../shared/protocol";

/** The parts of a WebSocket we use (so tests can pass a fake). */
export type RoomSocket = Pick<WebSocket, "addEventListener" | "close" | "send">;

/** Waits between reconnection attempts; the last one repeats. */
export const retryDelays = [1000, 2000, 4000, 8000, 15_000];

export interface RoomHandlers {
  /** Every valid message from the room; `welcome` arrives first on each (re)connection. */
  onMessage: (message: Message) => void;
  /** The connection dropped unexpectedly; we're trying to get it back. */
  onReconnecting: () => void;
  /** The room closed the connection on purpose (e.g. it was replaced). Not retried. */
  onClosed: () => void;
}

export interface RoomConnection {
  /** Sends if connected; dropped while reconnecting (the call recovers itself afterwards). */
  send: (message: Message) => void;
  /** Closes for good: no reconnecting. */
  close: () => void;
}

/**
 * A connection to the room that reconnects by itself after a drop (Wi-Fi blips,
 * a phone switching networks), waiting a little longer each time. The room
 * closes connections on purpose with codes 4000+, and those aren't retried.
 */
export function openRoom(connect: () => RoomSocket, handlers: RoomHandlers): RoomConnection {
  let socket: RoomSocket;
  let stopped = false;
  let attempts = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const open = (): void => {
    socket = connect();
    socket.addEventListener("message", (event: MessageEvent) => {
      const message = parseMessage(event.data);
      if (!message) return; // not valid: ignored
      if (message.type === "welcome") attempts = 0;
      handlers.onMessage(message);
    });
    socket.addEventListener("close", (event: CloseEvent) => {
      if (stopped) return;
      if (event.code >= 4000) {
        stopped = true;
        handlers.onClosed();
        return;
      }
      handlers.onReconnecting();
      const delay = retryDelays[Math.min(attempts, retryDelays.length - 1)];
      attempts += 1;
      retry = setTimeout(open, delay);
    });
  };
  open();

  return {
    send: (message) => {
      try {
        socket.send(JSON.stringify(message));
      } catch {
        // Not connected right now.
      }
    },
    close: () => {
      stopped = true;
      clearTimeout(retry);
      socket.close();
    },
  };
}
