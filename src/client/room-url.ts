import type { Role } from "../shared/roles";

/** WebSocket URL for the room, on the same host as the page. */
export function roomUrl(page: URL, role: Role): string {
  const url = new URL("/api/room", page);
  url.protocol = page.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("role", role);
  return url.toString();
}
