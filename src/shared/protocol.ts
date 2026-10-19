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
  /** Room → callers: the receiver's availability (and, during a call, who's calling). */
  | { type: "status"; status: Status; caller?: string }
  /** Room → receiver: who's calling, when a call starts. */
  | { type: "incoming"; name: string };

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
    case "status":
      if (!isStatus(value.status)) return undefined;
      return typeof value.caller === "string"
        ? { type: "status", status: value.status, caller: value.caller }
        : { type: "status", status: value.status };
    case "incoming":
      return typeof value.name === "string" ? { type: "incoming", name: value.name } : undefined;
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
