import { parseDirectory } from "./directory";
import { iceServers } from "./turn";

export { Room } from "./room";

/**
 * Routes:
 *   /api/ice-servers    STUN/TURN servers for a call
 *   /<group>/           the app (same page for every role)
 *   /<group>/api/room   WebSocket to the group's room
 * Everything else, including unknown groups, is a 404. Built assets
 * (/assets/*) are served by Cloudflare without running the Worker.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/ice-servers") {
      // Credentials are per call, so never cache them.
      return Response.json(
        { iceServers: await iceServers(env) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    const [, slug, rest] = /^\/([^/]+)(\/.*)?$/.exec(url.pathname) ?? [];
    if (!slug || !parseDirectory(env.DIRECTORY).group(slug)) return notFound();

    switch (rest) {
      case undefined:
        return Response.redirect(new URL(`/${slug}/${url.search}`, url).toString(), 301);
      case "/":
        return env.ASSETS.fetch(new URL("/", url));
      case "/api/room":
        return env.ROOM.getByName(slug).fetch(request);
      default:
        return notFound();
    }
  },
} satisfies ExportedHandler<Env>;

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
