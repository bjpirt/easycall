import type { Message, Status } from "../shared/protocol";
import type { Role } from "../shared/roles";

export interface Connection {
  id: string;
  role: Role;
}

export interface RoomState {
  /** The connected receiver, if any. */
  receiver: string | null;
  /** All connected callers, in the call or not. */
  callers: string[];
  /** The caller currently in a call with the receiver. */
  active: string | null;
}

export type Effect =
  | { type: "send"; to: string; message: Message }
  | { type: "close"; id: string; reason: string }
  /** Start (or restart) or stop the ready-window timer. */
  | { type: "timer"; running: boolean };

export interface Transition {
  state: RoomState;
  effects: Effect[];
}

export const emptyRoom: RoomState = { receiver: null, callers: [], active: null };

export function status(state: RoomState): Status {
  if (state.receiver === null) return "unavailable";
  return state.active === null ? "available" : "in-call";
}

export function connect(state: RoomState, { id, role }: Connection): Transition {
  if (role === "caller") {
    const next = { ...state, callers: [...state.callers, id] };
    return { state: next, effects: [send(id, { type: "status", status: status(next) })] };
  }
  // A new receiver (e.g. the tablet reloaded) replaces the old one and ends any call.
  const effects: Effect[] = [];
  if (state.receiver !== null) {
    effects.push({ type: "close", id: state.receiver, reason: "Replaced by a newer connection" });
  }
  if (state.active !== null) effects.push(send(state.active, { type: "hangup" }));
  return finish(state, { ...state, receiver: id, active: null }, effects);
}

export function receive(state: RoomState, from: Connection, message: Message): Transition {
  const isActive = from.role === "caller" && from.id === state.active;

  switch (message.type) {
    case "join":
      if (from.role !== "caller" || isActive) return unchanged(state);
      if (state.receiver === null || state.active !== null) {
        // Only one caller at a time.
        return { state, effects: [send(from.id, { type: "refused" })] };
      }
      return finish(state, { ...state, active: from.id }, [send(from.id, { type: "joined" })]);

    case "hangup":
      if (!isActive || state.receiver === null) return unchanged(state);
      return finish(state, { ...state, active: null }, [send(state.receiver, { type: "hangup" })]);

    case "offer":
    case "answer":
    case "candidate": {
      // Signals only flow between the receiver and the caller in the call.
      const to = isActive ? state.receiver : from.role === "receiver" ? state.active : null;
      return { state, effects: to === null ? [] : [send(to, message)] };
    }

    default:
      return unchanged(state); // the rest only ever come from the room
  }
}

export function disconnect(state: RoomState, { id, role }: Connection): Transition {
  if (role === "caller") {
    const next = { ...state, callers: state.callers.filter((c) => c !== id) };
    if (id !== state.active) return { state: next, effects: [] };
    // Reconnect grace periods come later (step 23); for now the call ends.
    const effects = state.receiver === null ? [] : [send(state.receiver, { type: "hangup" })];
    return finish(state, { ...next, active: null }, effects);
  }
  if (id !== state.receiver) return unchanged(state); // an already-replaced receiver
  const effects = state.active === null ? [] : [send(state.active, { type: "hangup" })];
  return finish(state, { ...state, receiver: null, active: null }, effects);
}

/** The ready window ran out: if nobody has called, send the receiver away. */
export function timeout(state: RoomState): Transition {
  if (!isWaiting(state) || state.receiver === null) return unchanged(state);
  return finish(state, { ...state, receiver: null }, [
    send(state.receiver, { type: "timeout" }),
    { type: "close", id: state.receiver, reason: "No calls within the ready window" },
  ]);
}

/** The receiver is there and nobody has called: the ready window is running. */
function isWaiting(state: RoomState): boolean {
  return state.receiver !== null && state.active === null;
}

function send(to: string, message: Message): Effect {
  return { type: "send", to, message };
}

function unchanged(state: RoomState): Transition {
  return { state, effects: [] };
}

/**
 * Adds the knock-on effects of a change: a status update for every caller if
 * the status changed, and starting or stopping the ready-window timer as the
 * receiver starts or stops waiting.
 */
function finish(before: RoomState, after: RoomState, effects: Effect[]): Transition {
  const all = [...effects];

  const now = status(after);
  if (now !== status(before)) {
    all.push(...after.callers.map((id) => send(id, { type: "status", status: now })));
  }

  const startedWaiting =
    isWaiting(after) && (!isWaiting(before) || before.receiver !== after.receiver);
  if (startedWaiting) all.push({ type: "timer", running: true });
  else if (isWaiting(before) && !isWaiting(after)) all.push({ type: "timer", running: false });

  return { state: after, effects: all };
}
