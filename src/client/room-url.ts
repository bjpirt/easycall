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
