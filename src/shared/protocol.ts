/** An ICE candidate as sent over the wire (mirrors RTCIceCandidateInit). */
export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

/** WebRTC signalling, handled by the peer connection. */
export type Signal =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: IceCandidate };

export const statuses = ["unavailable", "available", "in-call"] as const;

/** The receiver's availability, as callers see it. */
export type Status = (typeof statuses)[number];

/** Everything sent over the room socket. */
export type Message =
  /** Relayed between the receiver and the caller in the call. */
  | Signal
  /** A deliberate end to the call, as opposed to a lost connection. */
  | { type: "hangup" }
  /**
   * Room → anyone who connects, first. `resumed` means they've got their place
   * back after a dropped connection (e.g. they're still in the call). `version`
   * is the app version now deployed, so an old page knows to update.
   */
  | { type: "welcome"; resumed: boolean; version: string }
  /** Caller → room: start a call with the receiver. */
  | { type: "join" }
  /** Room → caller: you're in the call; send your offer. */
  | { type: "joined" }
  /** Room → caller: you can't join (someone else is in the call, or no receiver). */
  | { type: "refused" }
  /** Room → receiver: nobody called within the ready window, so you've been disconnected. */
  | { type: "timeout" }
  /**
   * Room → callers: the receiver's availability. During a call, `caller` is
   * who's in it, and `rejoin` means it's your call, dropped (e.g. you closed the
   * app), and you can join it again.
   */
  | { type: "status"; status: Status; caller?: string; rejoin?: true }
  /**
   * Room → receiver: who's calling, when a call starts (or the receiver
   * reconnects mid-call). A different `call` means a new connection from the
   * caller, needing a fresh peer connection.
   */
  | { type: "incoming"; name: string; call: string };

/** Parses a raw WebSocket message, returning `undefined` if it isn't valid. */
export function parseMessage(raw: unknown): Message | undefined {
  if (typeof raw !== "string") return undefined;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  switch (value.type) {
    case "offer":
    case "answer":
      return typeof value.sdp === "string" ? { type: value.type, sdp: value.sdp } : undefined;
    case "candidate":
      return isIceCandidate(value.candidate)
        ? { type: "candidate", candidate: value.candidate }
        : undefined;
    case "hangup":
    case "join":
    case "joined":
    case "refused":
    case "timeout":
      return { type: value.type };
    case "welcome":
      return typeof value.resumed === "boolean" && typeof value.version === "string"
        ? { type: "welcome", resumed: value.resumed, version: value.version }
        : undefined;
    case "status": {
      if (!isStatus(value.status)) return undefined;
      const status = { type: "status", status: value.status } as const;
      if (typeof value.caller !== "string") return status;
      const inCall = { ...status, caller: value.caller };
      return value.rejoin === true ? { ...inCall, rejoin: true } : inCall;
    }
    case "incoming":
      return typeof value.name === "string" && typeof value.call === "string"
        ? { type: "incoming", name: value.name, call: value.call }
        : undefined;
    default:
      return undefined;
  }
}

function isStatus(value: unknown): value is Status {
  return statuses.includes(value as Status);
}

function isIceCandidate(value: unknown): value is IceCandidate {
  return (
    isRecord(value) &&
    typeof value.candidate === "string" &&
    (value.sdpMid === null || typeof value.sdpMid === "string") &&
    (value.sdpMLineIndex === null || typeof value.sdpMLineIndex === "number")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
