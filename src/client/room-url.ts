import type { Role } from "../shared/roles";

/** WebSocket URL for the room of the group whose page we're on (`/<group>/`). */
export function roomUrl(page: URL, role: Role): string {
  const url = new URL("api/room", page);
  url.protocol = page.protocol === "https:" ? "wss:" : "ws:";
  url.search = new URLSearchParams({ role }).toString();
  return url.toString();
}
