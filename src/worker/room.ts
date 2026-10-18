import { DurableObject } from "cloudflare:workers";
import { parseMessage } from "../shared/protocol";
import { isRole } from "../shared/roles";
import {
  connect,
  disconnect,
  emptyRoom,
  receive,
  type Connection,
  type RoomState,
  type Transition,
} from "./room-state";

/**
 * One room per group: a thin shell around the pure state machine in
 * `room-state.ts`. It loads the state, applies a transition, saves the result
 * and carries out the effects (sending messages, closing sockets).
 *
 * Uses the WebSocket Hibernation API, so an idle room costs nothing and
 * connections survive the object being evicted from memory.
 */
export class Room extends DurableObject<Env> {
  override fetch(request: Request): Response {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const role = new URL(request.url).searchParams.get("role");
    if (!isRole(role)) {
      return new Response("Unknown role", { status: 400 });
    }

    const connection: Connection = { id: crypto.randomUUID(), role };
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [connection.id]);
    server.serializeAttachment(connection);
    this.apply(connect(this.load(), connection));
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): void {
    const message = parseMessage(raw);
    if (message) this.apply(receive(this.load(), connectionOf(ws), message));
  }

  override webSocketClose(ws: WebSocket): void {
    this.leave(ws);
  }

  override webSocketError(ws: WebSocket): void {
    this.leave(ws);
  }

  private leave(ws: WebSocket): void {
    const connection = connectionOf(ws);
    this.apply(disconnect(this.load(connection.id), connection));
  }

  /**
   * The saved state, minus any connections that are no longer live (e.g. after
   * a restart dropped every socket). `leaving` is kept so it can be disconnected.
   */
  private load(leaving?: string): RoomState {
    const live = new Set(this.ctx.getWebSockets().map((ws) => connectionOf(ws).id));
    if (leaving) live.add(leaving);
    const isLive = (id: string | null) => (id !== null && live.has(id) ? id : null);

    const saved = this.ctx.storage.kv.get<RoomState>("state") ?? emptyRoom;
    return {
      receiver: isLive(saved.receiver),
      callers: saved.callers.filter((id) => live.has(id)),
      active: isLive(saved.active),
    };
  }

  private apply({ state, effects }: Transition): void {
    this.ctx.storage.kv.put("state", state);
    for (const effect of effects) {
      const [ws] = this.ctx.getWebSockets(effect.type === "send" ? effect.to : effect.id);
      try {
        if (effect.type === "send") ws?.send(JSON.stringify(effect.message));
        else ws?.close(4000, "Replaced by a newer connection");
      } catch {
        // The socket closed in the meantime; its close handler will tidy up.
      }
    }
  }
}

function connectionOf(ws: WebSocket): Connection {
  return ws.deserializeAttachment() as Connection;
}
