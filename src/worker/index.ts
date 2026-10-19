import { roomRole } from "../shared/roles";
import { devLogin, devLoginEnabled } from "./dev-login";
import { parseDirectory, slugPattern } from "./directory";
import { homePage } from "./home";
import { login } from "./login";
import { manifest } from "./manifest";
import { readSession, sessionCookie } from "./session";
import { iceServers } from "./turn";
import { appVersion } from "../shared/version";

export { Room } from "./room";

/**
 * Routes:
 *   /                          the home page, or your group's page if you're signed in
 *   /version                   the deployed app version (public), so open pages can update
 *   /login                     sign in (guarded by Cloudflare Access)
 *   /dev-login                 local sign-in (only with DEV_LOGIN=true, on localhost)
 *   /<group>/                  the app (same page for every role)
 *   /<group>/manifest.webmanifest   the installable app, for your role
 *   /<group>/api/me            who you are in the group
 *   /<group>/api/ice-servers   STUN/TURN servers for a call
 *   /<group>/api/room          WebSocket to the group's room
 * Group routes need a member's session: without one, the page redirects to
 * /login and the APIs return 401, whether or not the group exists (so nobody
 * can find out which do); non-members get a 404. The room only accepts
 * WebSockets from our own pages. Everything else is a 404. Built assets (/assets/*) and icons (/icons/*) are served by Cloudflare
 * without the Worker.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/version") {
      return Response.json({ version: appVersion }, { headers: noStore });
    }
    if (url.pathname === "/login") return login(request, env);
    if (url.pathname === "/dev-login") {
      return devLoginEnabled(env, url) ? devLogin(request, env.SESSION_SECRET) : notFound();
    }

    const directory = parseDirectory(env.DIRECTORY);
    if (url.pathname === "/") {
      // Signed in: straight to your group. Otherwise, what easyCall is and how to sign in.
      const email = await readSession(request, env.SESSION_SECRET);
      const home = email ? directory.groupOf(email) : undefined;
      if (home) return Response.redirect(new URL(`/${home.slug}/`, url).toString(), 302);
      return new Response(homePage(email), {
        headers: { ...noStore, "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Until you're signed in, every possible group looks the same, so nobody can
    // find out which groups exist (a group's name might be a family's surname).
    const [, slug, rest] = /^\/([^/]+)(\/.*)?$/.exec(url.pathname) ?? [];
    if (!slug || !slugPattern.test(slug)) return notFound();
    if (rest === undefined) {
      return Response.redirect(new URL(`/${slug}/${url.search}`, url).toString(), 301);
    }

    const secret = env.SESSION_SECRET;
    const email = await readSession(request, secret);
    if (!email || !secret) {
      if (rest !== "/")
        return Response.json({ error: "Not signed in" }, { status: 401, headers: noStore });
      const next = encodeURIComponent(url.pathname + url.search);
      return Response.redirect(new URL(`/login?next=${next}`, url).toString(), 302);
    }
    const group = directory.group(slug);
    const membership = group && directory.member(slug, email);
    if (!group || !membership) return notFound();
    const member = { email, ...membership };

    switch (rest) {
      case "/":
        return env.ASSETS.fetch(new URL("/", url));
      case "/manifest.webmanifest":
        return Response.json(manifest(group, member.role), {
          headers: { ...noStore, "Content-Type": "application/manifest+json" },
        });
      case "/api/me":
        return Response.json(
          {
            email: member.email,
            name: member.name,
            role: member.role,
            receiverName: group.receiverName,
          },
          { headers: { ...noStore, "Set-Cookie": await sessionCookie(member.email, secret) } },
        );
      case "/api/ice-servers":
        // Credentials are per call, so never cache them.
        return Response.json({ iceServers: await iceServers(env) }, { headers: noStore });
      case "/api/room": {
        // Only our own pages may connect (browsers send Origin with WebSockets), so
        // another site can't open a connection with a member's cookie.
        const origin = request.headers.get("Origin");
        if (origin !== null && origin !== url.origin) {
          return new Response("Forbidden", { status: 403 });
        }
        // The room trusts these: the role and name come from the directory and the
        // email from the session, never from the browser. Only the page id (which
        // tells apart pages signed in as the same person) comes from the browser.
        const target = new URL(request.url);
        target.search = new URLSearchParams({
          role: roomRole(member.role),
          email: member.email,
          name: member.name,
          page: url.searchParams.get("page") ?? "",
        }).toString();
        return env.ROOM.getByName(group.slug).fetch(new Request(target, request));
      }
      default:
        return notFound();
    }
  },
} satisfies ExportedHandler<Env>;

const noStore = { "Cache-Control": "no-store" };

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
