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
  /** Caller → room: start a call with the receiver. */
  | { type: "join" }
  /** Room → caller: you're in the call; send your offer. */
  | { type: "joined" }
  /** Room → caller: you can't join (someone else is in the call, or no receiver). */
  | { type: "refused" }
  /** Room → callers: the receiver's availability. */
  | { type: "status"; status: Status };

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
      return { type: value.type };
    case "status":
      return isStatus(value.status) ? { type: "status", status: value.status } : undefined;
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
