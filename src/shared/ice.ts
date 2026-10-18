/** An ICE (STUN/TURN) server, as returned by /api/ice-servers. Mirrors RTCIceServer. */
export interface IceServer {
  urls: string[];
  username?: string;
  credential?: string;
}

/** Used when TURN isn't configured or can't be reached: direct connections only. */
export const stunOnly: IceServer[] = [{ urls: ["stun:stun.cloudflare.com:3478"] }];

/**
 * Validates an ICE server list from an untrusted source, dropping URLs on port
 * 53, which browsers block (they'd only time out).
 */
export function parseIceServers(value: unknown): IceServer[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const servers: IceServer[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return undefined;
    const { urls, username, credential } = item as Record<string, unknown>;
    const list = typeof urls === "string" ? [urls] : urls;
    if (!Array.isArray(list) || !list.every((u) => typeof u === "string")) return undefined;
    const usable = list.filter((u) => !/:53(\?|$)/.test(u));
    if (usable.length === 0) continue;
    servers.push({
      urls: usable,
      ...(typeof username === "string" && { username }),
      ...(typeof credential === "string" && { credential }),
    });
  }
  return servers;
}
