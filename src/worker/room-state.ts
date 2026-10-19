import type { Message, Status } from "../shared/protocol";
import type { Role } from "../shared/roles";
import { appVersion } from "../shared/version";

export interface Connection {
  id: string;
  role: Role;
  /** The signed-in user (from the session), so they can be recognised when they reconnect. */
  email: string;
  /** Their name in the group (from the directory), shown to the others. */
  name: string;
  /**
   * The browser page (random per page load), so a page reconnecting can be told
   * apart from another page signed in as the same person.
   */
  page: string;
}

/**
 * Someone taking part in a call: the receiver, or the caller in the call.
 * `connection` is null while they're away: their connection dropped without a
 * hang-up, and their place is held for a grace period in case they reconnect.
 */
export interface Participant {
  email: string;
  name: string;
  connection: string | null;
}

/** The caller in the call: also which page they're on, and the call (for the receiver). */
export interface ActiveCaller extends Participant {
  page: string;
  /** Identifies this call (the connection that joined it), so the receiver can spot a new one. */
  call: string;
}

/** A connected caller, in the call or not. */
export interface Caller {
  id: string;
  email: string;
}

export interface RoomState {
  receiver: Participant | null;
  callers: Caller[];
  /** The caller in a call with the receiver. */
  active: ActiveCaller | null;
}

/**
 * - `ready`: the receiver is waiting and nobody has called (the ready window).
 * - `receiver-away` / `caller-away`: grace periods for a dropped connection.
 */
export const timerNames = ["ready", "receiver-away", "caller-away"] as const;

export type TimerName = (typeof timerNames)[number];

/** When each timer runs. `finish()` starts and stops them as these change. */
const timerRuns: Record<TimerName, (state: RoomState) => boolean> = {
  ready: (s) => isWaiting(s),
  "receiver-away": (s) => s.receiver?.connection === null,
  "caller-away": (s) => s.active?.connection === null,
};

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

export function connect(state: RoomState, { id, role, email, name, page }: Connection): Transition {
  if (role === "caller") {
    // Only the same page gets its place back. Another page (e.g. the app reopened)
    // can rejoin the call with Join Call instead.
    const away = state.active?.connection === null ? state.active : null;
    const resumes = away?.email === email && away.page === page;
    const active = resumes ? { ...away, connection: id } : state.active;
    const next = { ...state, callers: [...state.callers, { id, email }], active };
    return finish(state, next, [welcome(id, resumes), send(id, statusMessage(next, email))]);
  }

  if (state.receiver?.email === email) {
    // The same receiver reconnecting (or reloading): they keep their place, call and all.
    const old = state.receiver.connection;
    const effects: Effect[] = [welcome(id, true)];
    if (old !== null) effects.push(close(old, "Replaced by a newer connection"));
    if (state.active) effects.push(send(id, incoming(state.active)));
    return finish(state, { ...state, receiver: { email, name, connection: id } }, effects);
  }

  // A different receiver replaces the old one and ends any call.
  return finish(state, { ...withoutReceiver(state), receiver: { email, name, connection: id } }, [
    welcome(id, false),
    ...leaving(state, { receiver: { reason: "Replaced by a newer connection" }, caller: true }),
  ]);
}

export function receive(state: RoomState, from: Connection, message: Message): Transition {
  const isActive = from.id === state.active?.connection;
  const isReceiver = from.id === state.receiver?.connection;

  switch (message.type) {
    case "join": {
      if (from.role !== "caller" || isActive) return unchanged(state);
      if (!state.receiver?.connection || (state.active !== null && !canRejoin(state, from.email))) {
        // Only one caller at a time, and only while the receiver is connected.
        return { state, effects: [send(from.id, { type: "refused" })] };
      }
      const { email, name, id, page } = from;
      const active = { email, name, connection: id, page, call: id };
      return finish(state, { ...state, active }, [
        send(from.id, { type: "joined" }),
        send(state.receiver.connection, incoming(active)),
      ]);
    }

    case "hangup":
      if (isActive) return endCall(state);
      // Staff tapped End Call: gone straight away, not held as if the connection dropped.
      if (isReceiver) return receiverLeaves(state, { receiver: { reason: "Left" }, caller: true });
      return unchanged(state);

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
    const callers = state.callers.filter((c) => c.id !== id);
    const active =
      state.active?.connection === id ? { ...state.active, connection: null } : state.active;
    return finish(state, { ...state, callers, active }, []);
  }
  if (id !== state.receiver?.connection) return unchanged(state); // an already-replaced receiver
  return finish(state, { ...state, receiver: { ...state.receiver, connection: null } }, []);
}

/** A timer ran out. */
export function expire(state: RoomState, timer: TimerName): Transition {
  switch (timer) {
    case "ready":
      // Nobody called in time: send the receiver back to idle.
      if (!isWaiting(state)) return unchanged(state);
      return receiverLeaves(state, {
        receiver: { message: { type: "timeout" }, reason: "No calls within the ready window" },
      });
    case "receiver-away":
      // The receiver didn't come back: they're gone, and so is any call.
      if (!timerRuns["receiver-away"](state)) return unchanged(state);
      return receiverLeaves(state, { caller: true });
    case "caller-away":
      // The caller didn't come back: the call is over.
      return timerRuns["caller-away"](state) ? endCall(state) : unchanged(state);
  }
}

/** Who to tell when the receiver leaves the room (see `leaving`). */
interface Tell {
  /** Tell the receiver (if connected) with `message`, then close their connection with `reason`. */
  receiver?: { message?: Message; reason: string };
  /** Tell the caller in the call (if connected) it's over. */
  caller?: true;
}

/**
 * The receiver leaves the room, and with them any call. It's how every session
 * ends: the call ended, staff tapped End Call, nobody called, or the receiver
 * didn't come back. The tablet goes back to idle, and staff choose whether to
 * make it available again.
 */
function receiverLeaves(state: RoomState, tell: Tell): Transition {
  return finish(state, withoutReceiver(state), leaving(state, tell));
}

/** The call is over: the receiver is told, and leaves the room. */
function endCall(state: RoomState): Transition {
  return receiverLeaves(state, {
    receiver: { message: { type: "hangup" }, reason: "The call has ended" },
  });
}

function withoutReceiver(state: RoomState): RoomState {
  return { ...state, receiver: null, active: null };
}

/** What to send whoever's still connected as the receiver leaves. */
function leaving(state: RoomState, tell: Tell): Effect[] {
  const effects: Effect[] = [];
  const receiver = state.receiver?.connection;
  if (receiver && tell.receiver) {
    if (tell.receiver.message) effects.push(send(receiver, tell.receiver.message));
    effects.push(close(receiver, tell.receiver.reason));
  }
  const caller = state.active?.connection;
  if (caller && tell.caller) effects.push(send(caller, { type: "hangup" }));
  return effects;
}

/** The receiver is there (or briefly away) and nobody has called: the ready window runs. */
function isWaiting(state: RoomState): boolean {
  return state.receiver !== null && state.active === null;
}

/** Whether `email` can join the call in place of the caller, who's away (e.g. the app was reopened). */
function canRejoin(state: RoomState, email: string): boolean {
  return state.active?.connection === null && state.active.email === email;
}

/** The status a caller sees: during a call, who's in it, and whether it's theirs to rejoin. */
function statusMessage(state: RoomState, email: string): Message {
  const now = status(state);
  if (now !== "in-call" || !state.active) return { type: "status", status: now };
  const message = { type: "status", status: now, caller: state.active.name } as const;
  return canRejoin(state, email) ? { ...message, rejoin: true } : message;
}

/** Tells the receiver who's calling, and which call it is. */
function incoming({ name, call }: ActiveCaller): Message {
  return { type: "incoming", name, call };
}

function send(to: string, message: Message): Effect {
  return { type: "send", to, message };
}

function close(id: string, reason: string): Effect {
  return { type: "close", id, reason };
}

function welcome(to: string, resumed: boolean): Effect {
  return send(to, { type: "welcome", resumed, version: appVersion });
}

function timer(name: TimerName, running: boolean): Effect {
  return { type: "timer", name, running };
}

function unchanged(state: RoomState): Transition {
  return { state, effects: [] };
}

/**
 * Adds the knock-on effects of a change: a status update for each caller whose
 * status changed, and starting or stopping timers as their conditions begin or
 * end.
 */
function finish(before: RoomState, after: RoomState, effects: Effect[]): Transition {
  const all = [...effects];

  for (const { id, email } of after.callers) {
    if (!before.callers.some((c) => c.id === id)) continue; // told when they connected
    const message = statusMessage(after, email);
    if (JSON.stringify(message) !== JSON.stringify(statusMessage(before, email))) {
      all.push(send(id, message));
    }
  }

  for (const name of timerNames) {
    const was = timerRuns[name](before);
    const is = timerRuns[name](after);
    // A different receiver taking over while waiting gets a fresh ready window.
    const restart =
      name === "ready" && was && is && before.receiver?.email !== after.receiver?.email;
    if (was !== is || restart) all.push(timer(name, is));
  }

  return { state: after, effects: all };
}
