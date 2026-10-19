/**
 * How a call's media connection is doing, as people see it: `connecting` until
 * media first flows, then `connected`, or `interrupted` while it's recovering.
 */
export type MediaState = "connecting" | "connected" | "interrupted";

/** Maps the peer connection's state, given whether media has flowed yet in this call. */
export function mediaState(
  state: RTCPeerConnectionState,
  connectedBefore: boolean,
): MediaState | undefined {
  if (state === "connected") return "connected";
  if (state === "disconnected" || state === "failed") {
    return connectedBefore ? "interrupted" : "connecting";
  }
  return undefined; // new / connecting / closed: no change worth showing
}

/**
 * Follows a call's peer connection states, reporting each change worth showing
 * (`connecting` until media first flows, then `connected` or `interrupted`).
 * Returns the state it reported, if any.
 */
export function mediaTracker(
  onMedia: (media: MediaState) => void,
): (state: RTCPeerConnectionState) => MediaState | undefined {
  let connectedBefore = false;
  return (state) => {
    const media = mediaState(state, connectedBefore);
    if (media === "connected") connectedBefore = true;
    if (media) onMedia(media);
    return media;
  };
}

/** The notice over a call screen, if any. */
export function callNotice(media: MediaState, roomReconnecting: boolean): string | undefined {
  if (roomReconnecting || media === "interrupted") return "Reconnecting…";
  if (media === "connecting") return "Connecting…";
  return undefined;
}
