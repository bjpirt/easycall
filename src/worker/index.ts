export { Room } from "./room";

export default {
  fetch(request, env): Promise<Response> | Response {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/room") {
      // A single shared room until groups arrive (step 13).
      return env.ROOM.getByName("dev").fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
