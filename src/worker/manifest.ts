import type { MemberRole } from "../shared/roles";
import type { Group } from "./directory";

/**
 * The web app manifest for a group (`/<group>/manifest.webmanifest`), so each
 * group installs as its own app. It depends on who's installing it: the
 * receiver's tablet launches full screen; callers get an ordinary app window,
 * named after who they're calling.
 */
export function manifest(group: Group, role: MemberRole): object {
  const path = `/${group.slug}/`;
  const receiver = role === "receiver";
  const name = receiver ? "easyCall" : `Call ${group.displayName}`;
  return {
    id: path,
    name,
    short_name: name,
    start_url: path,
    scope: path,
    display: receiver ? "fullscreen" : "standalone",
    background_color: "#111111",
    theme_color: "#111111",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
