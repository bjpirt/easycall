import { DurableObject } from "cloudflare:workers";
import { parseMessage } from "../shared/protocol";
import { isRole, roomRole } from "../shared/roles";
import { parseDirectory } from "./directory";
import {
  connect,
  disconnect,
  emptyRoom,
  expire,
  receive,
  type Connection,
  type Participant,
  type RoomState,
  type TimerName,
  type Transition,
} from "./room-state";

type Deadlines = Partial<Record<TimerName, number>>;

/** What each socket remembers: its connection, and the group it's in. */
type Attachment = Connection & { group: string };

/**
 * One room per group: a thin shell around the pure state machine in
 * `room-state.ts`. It loads the state, applies a transition, saves the result
 * and carries out the effects (sending messages, closing sockets, timers).
 *
 * Timers are deadlines kept in storage, with one DO alarm set for the earliest.
 * Uses the WebSocket Hibernation API, so an idle room costs nothing and
 * connections survive the object being evicted from memory.
 */
export class Room extends DurableObject<Env> {
  /**
   * Only the Worker can reach a DO, so `group`, `role`, `email` and `name` come
   * from the URL, directory and session. `page` comes from the browser; it only
   * ever tells apart pages signed in as the same person.
   */
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const params = new URL(request.url).searchParams;
    const role = params.get("role");
    const email = params.get("email");
    const name = params.get("name");
    const group = params.get("group");
    if (!isRole(role) || !email || !name || !group) {
      return new Response("Unknown group, role, email or name", { status: 400 });
    }

    const id = crypto.randomUUID();
    const page = params.get("page") ?? "";
    const connection: Attachment = {
      id,
      group,
      role,
      email,
      name,
      page: /^[\w-]{1,64}$/.test(page) ? page : id, // without one, it can never resume
    };
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [connection.id]);
    server.serializeAttachment(connection);
    const removed = await this.removeFormerMembers();
    if (!removed.has(id)) await this.apply(connect(await this.load(), connection));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const message = parseMessage(raw);
    if (!message) return;
    const removed = await this.removeFormerMembers();
    if (removed.has(connectionOf(ws).id)) return; // no longer theirs to send
    await this.apply(receive(await this.load(), connectionOf(ws), message));
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.leave(ws);
  }

  /** One or more timers are due. */
  override async alarm(): Promise<void> {
    await this.removeFormerMembers();
    const due = (Object.entries(this.deadlines()) as [TimerName, number][])
      .filter(([, at]) => at <= Date.now())
      .sort(([, a], [, b]) => a - b);
    for (const [name] of due) {
      this.setDeadline(name, undefined);
      await this.apply(expire(await this.load(), name));
    }
    await this.scheduleAlarm();
  }

  /**
   * Members check in through the Worker only when they connect, so someone
   * removed from the group (or given another role) could otherwise keep an open
   * page connected. On every event, the room checks each connection against
   * the directory: anyone who no longer belongs leaves at once, as if they'd
   * hung up (ending any call they're in, with no grace period), and is
   * disconnected for good. Returns the connections removed.
   */
  private async removeFormerMembers(): Promise<Set<string>> {
    const directory = parseDirectory(this.env.DIRECTORY, () => undefined); // the Worker logs problems
    const removed = new Set<string>();
    for (const ws of this.ctx.getWebSockets()) {
      const connection = connectionOf(ws);
      const member = directory.member(connection.group, connection.email);
      if (member && roomRole(member.role) === connection.role) continue;
      removed.add(connection.id);
      await this.apply(receive(await this.load(), connection, { type: "hangup" }));
      try {
        ws.close(4000, "No longer in this group");
      } catch {
        // Already closed.
      }
    }
    return removed;
  }

  private async leave(ws: WebSocket): Promise<void> {
    const connection = connectionOf(ws);
    await this.apply(disconnect(await this.load(connection.id), connection));
  }

  /**
   * The saved state, checked against the live sockets. Sockets don't survive the
   * room restarting (e.g. for a deploy), and no close event arrives for them, so:
   * callers whose socket has gone are forgotten, and participants whose socket
   * has gone are treated as away, starting their grace period. They then
   * reconnect and carry on, and a deploy doesn't end a call. `leaving` is kept so
   * it can be disconnected properly.
   */
  private async load(leaving?: string): Promise<RoomState> {
    const live = new Set(this.ctx.getWebSockets().map((ws) => connectionOf(ws).id));
    if (leaving) live.add(leaving);

    const saved = this.ctx.storage.kv.get<RoomState>("state") ?? emptyRoom;
    const vanished: TimerName[] = [];
    const check = <P extends Participant>(p: P | null, timer: TimerName): P | null => {
      if (!p?.connection || live.has(p.connection)) return p; // absent, away, or still connected
      vanished.push(timer);
      return { ...p, connection: null };
    };
    const state = {
      receiver: check(saved.receiver, "receiver-away"),
      callers: saved.callers.filter((c) => live.has(c.id)),
      active: check(saved.active, "caller-away"),
    };

    if (vanished.length > 0) {
      const deadlines = this.deadlines();
      for (const name of vanished) {
        deadlines[name] ??= Date.now() + timerMs(name, this.env);
        this.setDeadline(name, deadlines[name]);
      }
      this.ctx.storage.kv.put("state", state);
      await this.scheduleAlarm();
    }
    return state;
  }

  private async apply({ state, effects }: Transition): Promise<void> {
    this.ctx.storage.kv.put("state", state);
    let timersChanged = false;
    for (const effect of effects) {
      if (effect.type === "timer") {
        const at = effect.running ? Date.now() + timerMs(effect.name, this.env) : undefined;
        this.setDeadline(effect.name, at);
        timersChanged = true;
        continue;
      }
      const [ws] = this.ctx.getWebSockets(effect.type === "send" ? effect.to : effect.id);
      try {
        if (effect.type === "send") ws?.send(JSON.stringify(effect.message));
        else ws?.close(4000, effect.reason);
      } catch {
        // The socket closed in the meantime; its close handler will tidy up.
      }
    }
    if (timersChanged) await this.scheduleAlarm();
  }

  private deadlines(): Deadlines {
    return this.ctx.storage.kv.get<Deadlines>("timers") ?? {};
  }

  private setDeadline(name: TimerName, at: number | undefined): void {
    const others = Object.fromEntries(
      Object.entries(this.deadlines()).filter(([key]) => key !== name),
    ) as Deadlines;
    this.ctx.storage.kv.put("timers", at === undefined ? others : { ...others, [name]: at });
  }

  /** Points the DO's single alarm at the earliest deadline, if any. */
  private async scheduleAlarm(): Promise<void> {
    const next = Math.min(...Object.values(this.deadlines()));
    if (Number.isFinite(next)) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
}

/** How long each timer runs. */
export function timerMs(
  name: TimerName,
  env: { READY_WINDOW_MINUTES?: string; GRACE_SECONDS?: string },
): number {
  return name === "ready" ? readyWindowMs(env) : graceMs(env);
}

/** How long the receiver waits for a call before going idle (default 30 minutes). */
export function readyWindowMs(env: { READY_WINDOW_MINUTES?: string }): number {
  return positive(env.READY_WINDOW_MINUTES, 30) * 60_000;
}

/** How long a dropped participant's place is held for them to reconnect (default 30 seconds). */
export function graceMs(env: { GRACE_SECONDS?: string }): number {
  return positive(env.GRACE_SECONDS, 30) * 1000;
}

function positive(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function connectionOf(ws: WebSocket): Attachment {
  return ws.deserializeAttachment() as Attachment;
}
