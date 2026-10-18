import { DurableObject } from "cloudflare:workers";
import { isRole, type Role } from "../shared/roles";

/**
 * One room per group. Holds the receiver's and callers' WebSockets and relays
 * messages between them: receiver → callers, caller → receiver.
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

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [role]);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    const target: Role = this.roleOf(ws) === "receiver" ? "caller" : "receiver";
    for (const peer of this.ctx.getWebSockets(target)) {
      peer.send(message);
    }
  }

  private roleOf(ws: WebSocket): Role | undefined {
    return this.ctx.getTags(ws).find(isRole);
  }
}
