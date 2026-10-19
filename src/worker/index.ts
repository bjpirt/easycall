import type { MemberRole } from "../shared/roles";
import { roomRole } from "../shared/roles";
import { devLogin } from "./dev-login";
import { parseDirectory, type Directory, type Group } from "./directory";
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
 *   /dev-login                 local sign-in (only when DEV_LOGIN=true)
 *   /<group>/                  the app (same page for every role)
 *   /<group>/manifest.webmanifest   the installable app, for your role
 *   /<group>/api/me            who you are in the group
 *   /<group>/api/ice-servers   STUN/TURN servers for a call
 *   /<group>/api/room          WebSocket to the group's room
 * Group routes need a member's session: without one, the page redirects to
 * /login and the APIs return 401; non-members get a 404. Everything else is a
 * 404. Built assets (/assets/*) and icons (/icons/*) are served by Cloudflare
 * without the Worker.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/version") {
      return Response.json({ version: appVersion }, { headers: noStore });
    }
    if (url.pathname === "/login") return login(request, env);
    if (url.pathname === "/dev-login" && env.DEV_LOGIN === "true") {
      return devLogin(request, env.SESSION_SECRET);
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

    const [, slug, rest] = /^\/([^/]+)(\/.*)?$/.exec(url.pathname) ?? [];
    const group = slug ? directory.group(slug) : undefined;
    if (!group) return notFound();
    if (rest === undefined) {
      return Response.redirect(new URL(`/${group.slug}/${url.search}`, url).toString(), 301);
    }

    const member = await authenticate(request, env, directory, group);
    if (member.type === "not-member") return notFound();
    if (member.type === "signed-out") {
      if (rest !== "/")
        return Response.json({ error: "Not signed in" }, { status: 401, headers: noStore });
      const next = encodeURIComponent(url.pathname + url.search);
      return Response.redirect(new URL(`/login?next=${next}`, url).toString(), 302);
    }

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
          {
            headers: { ...noStore, "Set-Cookie": await sessionCookie(member.email, member.secret) },
          },
        );
      case "/api/ice-servers":
        // Credentials are per call, so never cache them.
        return Response.json({ iceServers: await iceServers(env) }, { headers: noStore });
      case "/api/room": {
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

type Member =
  /** `secret` is the session secret (known to be set), for renewing the cookie. */
  | { type: "member"; email: string; name: string; role: MemberRole; secret: string }
  | { type: "signed-out" }
  | { type: "not-member" };

/** Who's making the request, and whether they're in the group. */
async function authenticate(
  request: Request,
  env: Env,
  directory: Directory,
  group: Group,
): Promise<Member> {
  const secret = env.SESSION_SECRET;
  const email = await readSession(request, secret);
  if (!email || !secret) return { type: "signed-out" };
  const member = directory.member(group.slug, email);
  return member ? { type: "member", email, ...member, secret } : { type: "not-member" };
}

const noStore = { "Cache-Control": "no-store" };

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}
