import { devLogin } from "./dev-login";
import { parseDirectory, type Directory, type Group } from "./directory";
import { login } from "./login";
import { readSession, sessionCookie } from "./session";
import { iceServers } from "./turn";

export { Room } from "./room";

/**
 * Routes:
 *   /api/ice-servers    STUN/TURN servers for a call
 *   /login              sign in (guarded by Cloudflare Access)
 *   /dev-login          local sign-in (only when DEV_LOGIN=true)
 *   /<group>/           the app (same page for every role)
 *   /<group>/api/me     who you are in the group
 *   /<group>/api/room   WebSocket to the group's room
 * Everything else, including unknown groups, is a 404. Built assets
 * (/assets/*) are served by Cloudflare without running the Worker.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/ice-servers") {
      // Credentials are per call, so never cache them.
      return Response.json({ iceServers: await iceServers(env) }, { headers: noStore });
    }
    if (url.pathname === "/login") return login(request, env);
    if (url.pathname === "/dev-login" && env.DEV_LOGIN === "true") {
      return devLogin(request, env.SESSION_SECRET);
    }

    const [, slug, rest] = /^\/([^/]+)(\/.*)?$/.exec(url.pathname) ?? [];
    const directory = parseDirectory(env.DIRECTORY);
    const group = slug ? directory.group(slug) : undefined;
    if (!group) return notFound();

    switch (rest) {
      case undefined:
        return Response.redirect(new URL(`/${group.slug}/${url.search}`, url).toString(), 301);
      case "/":
        return env.ASSETS.fetch(new URL("/", url));
      case "/api/me":
        return me(request, env, directory, group);
      case "/api/room":
        return env.ROOM.getByName(group.slug).fetch(request);
      default:
        return notFound();
    }
  },
} satisfies ExportedHandler<Env>;

const noStore = { "Cache-Control": "no-store" };

/** Your role in the group: 401 if not signed in, 404 if not a member. Renews the session. */
async function me(
  request: Request,
  env: Env,
  directory: Directory,
  group: Group,
): Promise<Response> {
  const secret = env.SESSION_SECRET;
  const email = await readSession(request, secret);
  if (!email || !secret)
    return Response.json({ error: "Not signed in" }, { status: 401, headers: noStore });

  const role = directory.role(group.slug, email);
  if (!role) return notFound();
  return Response.json(
    { email, role, displayName: group.displayName },
    { headers: { ...noStore, "Set-Cookie": await sessionCookie(email, secret) } },
  );
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
