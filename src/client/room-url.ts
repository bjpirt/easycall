/** WebSocket URL for the room of the group whose page we're on (`/<group>/`). */
export function roomUrl(page: URL): string {
  const url = new URL("api/room", page);
  url.protocol = page.protocol === "https:" ? "wss:" : "ws:";
  url.search = "";
  return url.toString();
}
