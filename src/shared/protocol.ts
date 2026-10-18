/** An ICE candidate as sent over the wire (mirrors RTCIceCandidateInit). */
export interface IceCandidate {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
}

/** WebRTC signalling messages, relayed between caller and receiver by the room. */
export type Signal =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "candidate"; candidate: IceCandidate };

/** Parses a raw WebSocket message, returning `undefined` if it isn't a valid signal. */
export function parseSignal(raw: unknown): Signal | undefined {
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
    default:
      return undefined;
  }
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
