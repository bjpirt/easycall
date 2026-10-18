import { parseIceServers, stunOnly, type IceServer } from "../shared/ice";

/** Credentials last a day: far longer than any call. */
const ttlSeconds = 24 * 60 * 60;

/**
 * Short-lived ICE servers for a call: Cloudflare Realtime TURN (so calls work
 * on networks that block direct connections) plus STUN. Falls back to STUN only
 * if TURN isn't configured or the API fails, so a call can still be attempted.
 */
export async function iceServers(
  env: Pick<Env, "TURN_KEY_ID" | "TURN_KEY_API_TOKEN">,
  fetcher: typeof fetch = fetch,
): Promise<IceServer[]> {
  const { TURN_KEY_ID: keyId, TURN_KEY_API_TOKEN: token } = env;
  if (!keyId || !token) return stunOnly;

  try {
    const response = await fetcher(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: ttlSeconds }),
      },
    );
    if (!response.ok) throw new Error(`TURN API responded ${String(response.status)}`);
    const body: unknown = await response.json();
    const servers = parseIceServers((body as { iceServers?: unknown } | null)?.iceServers);
    if (!servers) throw new Error("Unexpected TURN API response");
    return servers;
  } catch (error) {
    console.error("Couldn't get TURN credentials; using STUN only", error);
    return stunOnly;
  }
}
