import type { JWTVerifyGetKey } from "jose";
import { verifyAccess } from "./access";
import { safePath } from "./safe-path";
import { sessionCookie } from "./session";

/**
 * `/login?next=/group/`: Cloudflare Access guards this path (email one-time
 * PIN). Once through, we check Access's token, start our own long-lived session
 * and go to `next`. Locally (DEV_LOGIN=true) it hands over to /dev-login.
 */
export async function login(
  request: Request,
  env: Env,
  /** Access's signing keys; fetched from the team domain unless given (tests). */
  keys?: JWTVerifyGetKey,
): Promise<Response> {
  const url = new URL(request.url);
  const next = safePath(url.searchParams.get("next"));

  if (env.DEV_LOGIN === "true") {
    return Response.redirect(
      new URL(`/dev-login?next=${encodeURIComponent(next)}`, url).toString(),
      302,
    );
  }

  const { ACCESS_TEAM_DOMAIN: teamDomain, ACCESS_AUD: audience, SESSION_SECRET: secret } = env;
  if (!teamDomain || !audience || !secret) {
    console.error("Sign-in needs ACCESS_TEAM_DOMAIN, ACCESS_AUD and SESSION_SECRET");
    return new Response("Sign-in isn't set up yet.", { status: 500 });
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  const config = { teamDomain, audience };
  const email = await (keys ? verifyAccess(token, config, keys) : verifyAccess(token, config));
  if (!email) return new Response("Sign-in failed. Please try again.", { status: 401 });

  return new Response(null, {
    status: 302,
    headers: { Location: next, "Set-Cookie": await sessionCookie(email, secret) },
  });
}
