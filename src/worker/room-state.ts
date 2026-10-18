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

export type Effect = { type: "send"; to: string; message: Message } | { type: "close"; id: string };

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
  if (state.receiver !== null) effects.push({ type: "close", id: state.receiver });
  if (state.active !== null) effects.push(send(state.active, { type: "hangup" }));
  return withStatus(state, { ...state, receiver: id, active: null }, effects);
}

export function receive(state: RoomState, from: Connection, message: Message): Transition {
  const isActive = from.role === "caller" && from.id === state.active;

  switch (message.type) {
    case "join":
      if (from.role !== "caller" || state.receiver === null || state.active !== null) {
        return unchanged(state);
      }
      return withStatus(state, { ...state, active: from.id }, [send(from.id, { type: "joined" })]);

    case "hangup":
      if (!isActive || state.receiver === null) return unchanged(state);
      return withStatus(state, { ...state, active: null }, [
        send(state.receiver, { type: "hangup" }),
      ]);

    case "offer":
    case "answer":
    case "candidate": {
      // Signals only flow between the receiver and the caller in the call.
      const to = isActive ? state.receiver : from.role === "receiver" ? state.active : null;
      return { state, effects: to === null ? [] : [send(to, message)] };
    }

    default:
      return unchanged(state); // `joined` and `status` only come from the room
  }
}

export function disconnect(state: RoomState, { id, role }: Connection): Transition {
  if (role === "caller") {
    const next = { ...state, callers: state.callers.filter((c) => c !== id) };
    if (id !== state.active) return { state: next, effects: [] };
    // Reconnect grace periods come later (step 23); for now the call ends.
    const effects = state.receiver === null ? [] : [send(state.receiver, { type: "hangup" })];
    return withStatus(state, { ...next, active: null }, effects);
  }
  if (id !== state.receiver) return unchanged(state); // an already-replaced receiver
  const effects = state.active === null ? [] : [send(state.active, { type: "hangup" })];
  return withStatus(state, { ...state, receiver: null, active: null }, effects);
}

function send(to: string, message: Message): Effect {
  return { type: "send", to, message };
}

function unchanged(state: RoomState): Transition {
  return { state, effects: [] };
}

/** Adds a status update for every caller if the status changed. */
function withStatus(before: RoomState, after: RoomState, effects: Effect[]): Transition {
  const now = status(after);
  if (now === status(before)) return { state: after, effects };
  const updates = after.callers.map((id) => send(id, { type: "status", status: now }));
  return { state: after, effects: [...effects, ...updates] };
}
