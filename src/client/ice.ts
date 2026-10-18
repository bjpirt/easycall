import { parseIceServers, stunOnly, type IceServer } from "../shared/ice";

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
