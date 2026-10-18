import { iceServers } from "./turn";

export { Room } from "./room";

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/room") {
      // A single shared room until groups arrive (step 13).
      return env.ROOM.getByName("dev").fetch(request);
    }
    if (pathname === "/api/ice-servers") {
      // Credentials are per call, so never cache them.
      return Response.json(
        { iceServers: await iceServers(env) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
