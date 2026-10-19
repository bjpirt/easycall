import { parseIceServers, stunOnly, type IceServer } from "../shared/ice";
import { parseMe, type Me } from "../shared/me";

// Talking to the Worker about the group whose page we're on (`/<group>/`). URLs
// are relative to the page, so they're the group's own.

export type MeResult =
  { type: "member"; me: Me } | { type: "signed-out" } | { type: "not-member" } | { type: "error" };

/** Asks the Worker who we are in this page's group (`/<group>/api/me`). */
export async function fetchMe(page: URL, fetcher: typeof fetch = fetch): Promise<MeResult> {
  try {
    const response = await fetcher(new URL("api/me", page));
    if (response.status === 401) return { type: "signed-out" };
    if (response.status === 404) return { type: "not-member" };
    const me = response.ok ? parseMe(await response.json()) : undefined;
    return me ? { type: "member", me } : { type: "error" };
  } catch {
    return { type: "error" };
  }
}

/** Fresh ICE servers for a call from this page's group; STUN only if that fails. */
export async function fetchIceServers(
  page: URL,
  fetcher: typeof fetch = fetch,
): Promise<IceServer[]> {
  try {
    const response = await fetcher(new URL("api/ice-servers", page));
    if (!response.ok) throw new Error(`ICE servers: ${String(response.status)}`);
    const body: unknown = await response.json();
    return parseIceServers((body as { iceServers?: unknown } | null)?.iceServers) ?? stunOnly;
  } catch (error) {
    console.error("Couldn't get ICE servers; using STUN only", error);
    return stunOnly;
  }
}

/**
 * WebSocket URL for the room of the group whose page we're on (`/<group>/`).
 * `pageId` identifies this page load, so the room can give it its place back
 * after a dropped connection (and not to another page signed in as us).
 */
export function roomUrl(page: URL, pageId: string): string {
  const url = new URL("api/room", page);
  url.protocol = page.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams({ page: pageId }).toString();
  return url.toString();
}
