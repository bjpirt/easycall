import type { Message, Status } from "../shared/protocol";
import type { Role } from "../shared/roles";

export interface Connection {
  id: string;
  role: Role;
  /** The signed-in user (from the session), so they can be recognised when they reconnect. */
  email: string;
}

/**
 * Someone taking part in a call: the receiver, or the caller in the call.
 * `connection` is null while they're away: their connection dropped without a
 * hang-up, and their place is held for a grace period in case they reconnect.
 */
export interface Participant {
  email: string;
  connection: string | null;
}

export interface RoomState {
  receiver: Participant | null;
  /** Connected callers (connection ids), in the call or not. */
  callers: string[];
  /** The caller in a call with the receiver. */
  active: Participant | null;
}

/**
 * - `ready`: the receiver is waiting and nobody has called (the ready window).
 * - `receiver-away` / `caller-away`: grace periods for a dropped connection.
 */
export type TimerName = "ready" | "receiver-away" | "caller-away";

export type Effect =
  | { type: "send"; to: string; message: Message }
  | { type: "close"; id: string; reason: string }
  /** Start (or restart) or stop a timer. When one runs out, call `expire`. */
  | { type: "timer"; name: TimerName; running: boolean };

export interface Transition {
  state: RoomState;
  effects: Effect[];
}

export const emptyRoom: RoomState = { receiver: null, callers: [], active: null };

export function status(state: RoomState): Status {
  if (state.receiver === null) return "unavailable";
  return state.active === null ? "available" : "in-call";
}

export function connect(state: RoomState, { id, role, email }: Connection): Transition {
  if (role === "caller") {
    const callers = [...state.callers, id];
    const resumes = state.active?.email === email && state.active.connection === null;
    const next = { ...state, callers, active: resumes ? { email, connection: id } : state.active };
    return finish(state, next, [
      welcome(id, resumes),
      send(id, { type: "status", status: status(next) }),
    ]);
  }

  if (state.receiver?.email === email) {
    // The same receiver reconnecting (or reloading): they keep their place, call and all.
    const old = state.receiver.connection;
    const effects = old === null ? [] : [close(old, "Replaced by a newer connection")];
    return finish(state, { ...state, receiver: { email, connection: id } }, [
      welcome(id, true),
      ...effects,
    ]);
  }

  // A different receiver replaces the old one and ends any call.
  const effects: Effect[] = [welcome(id, false)];
  const old = state.receiver?.connection;
  if (old) effects.push(close(old, "Replaced by a newer connection"));
  if (state.active?.connection) effects.push(send(state.active.connection, { type: "hangup" }));
  return finish(state, { ...state, receiver: { email, connection: id }, active: null }, effects);
}

export function receive(state: RoomState, from: Connection, message: Message): Transition {
  const isActive = from.role === "caller" && from.id === state.active?.connection;
  const isReceiver = from.role === "receiver" && from.id === state.receiver?.connection;

  switch (message.type) {
    case "join":
      if (from.role !== "caller" || isActive) return unchanged(state);
      if (!state.receiver?.connection || state.active !== null) {
        // Only one caller at a time, and only while the receiver is connected.
        return { state, effects: [send(from.id, { type: "refused" })] };
      }
      return finish(state, { ...state, active: { email: from.email, connection: from.id } }, [
        send(from.id, { type: "joined" }),
      ]);

    case "hangup":
      return isActive ? endCall(state) : unchanged(state);

    case "offer":
    case "answer":
    case "candidate": {
      // Signals only flow between the receiver and the caller in the call.
      const to = isActive
        ? state.receiver?.connection
        : isReceiver
          ? state.active?.connection
          : null;
      return { state, effects: to ? [send(to, message)] : [] };
    }

    default:
      return unchanged(state); // the rest only ever come from the room
  }
}

/**
 * A connection closed. If it was a participant's, their place is held for a grace period
 * (no hang-up was sent, so it may just be a network blip).
 */
export function disconnect(state: RoomState, { id, role }: Connection): Transition {
  if (role === "caller") {
    const callers = state.callers.filter((c) => c !== id);
    const away = state.active?.connection === id;
    const active = away && state.active ? { ...state.active, connection: null } : state.active;
    return finish(state, { ...state, callers, active }, []);
  }
  if (id !== state.receiver?.connection) return unchanged(state); // an already-replaced receiver
  return finish(state, { ...state, receiver: { ...state.receiver, connection: null } }, []);
}

/** A timer ran out. */
export function expire(state: RoomState, timer: TimerName): Transition {
  switch (timer) {
    case "ready": {
      // Nobody called in time: send the receiver back to idle.
      if (!isWaiting(state) || !state.receiver) return unchanged(state);
      const { connection } = state.receiver;
      const effects = connection
        ? [
            send(connection, { type: "timeout" }),
            close(connection, "No calls within the ready window"),
          ]
        : [];
      return finish(state, { ...state, receiver: null }, effects);
    }
    case "receiver-away": {
      // The receiver didn't come back: they're gone, and so is any call.
      if (state.receiver?.connection !== null) return unchanged(state);
      const caller = state.active?.connection;
      const effects = caller ? [send(caller, { type: "hangup" })] : [];
      return finish(state, { ...state, receiver: null, active: null }, effects);
    }
    case "caller-away":
      // The caller didn't come back: the call is over.
      return state.active?.connection === null ? endCall(state) : unchanged(state);
  }
}

/**
 * The call is over: the receiver is told and leaves the room (back to idle, so
 * staff choose whether to make them available again).
 */
function endCall(state: RoomState): Transition {
  const receiver = state.receiver?.connection;
  const effects = receiver
    ? [send(receiver, { type: "hangup" }), close(receiver, "The call has ended")]
    : [];
  return finish(state, { ...state, receiver: null, active: null }, effects);
}

/** The receiver is there (or briefly away) and nobody has called: the ready window runs. */
function isWaiting(state: RoomState): boolean {
  return state.receiver !== null && state.active === null;
}

function send(to: string, message: Message): Effect {
  return { type: "send", to, message };
}

function close(id: string, reason: string): Effect {
  return { type: "close", id, reason };
}

function welcome(to: string, resumed: boolean): Effect {
  return send(to, { type: "welcome", resumed });
}

function timer(name: TimerName, running: boolean): Effect {
  return { type: "timer", name, running };
}

function unchanged(state: RoomState): Transition {
  return { state, effects: [] };
}

/**
 * Adds the knock-on effects of a change: a status update for every caller if
 * the status changed, and starting or stopping timers as their conditions
 * begin or end.
 */
function finish(before: RoomState, after: RoomState, effects: Effect[]): Transition {
  const all = [...effects];

  const now = status(after);
  if (now !== status(before)) {
    all.push(...after.callers.map((id) => send(id, { type: "status", status: now })));
  }

  // The ready window restarts if a different receiver takes over while waiting.
  const newReceiver = before.receiver?.email !== after.receiver?.email;
  if (isWaiting(after) && (!isWaiting(before) || newReceiver)) all.push(timer("ready", true));
  else if (isWaiting(before) && !isWaiting(after)) all.push(timer("ready", false));

  const away = {
    "receiver-away": (s: RoomState) => s.receiver !== null && s.receiver.connection === null,
    "caller-away": (s: RoomState) => s.active !== null && s.active.connection === null,
  } as const;
  for (const [name, isAway] of Object.entries(away) as [TimerName, (s: RoomState) => boolean][]) {
    if (isAway(after) !== isAway(before)) all.push(timer(name, isAway(after)));
  }

  return { state: after, effects: all };
}
