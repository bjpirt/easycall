import { escapeHtml } from "./html";
import { safePath } from "./safe-path";
import { sessionCookie } from "./session";

const localHosts = ["localhost", "127.0.0.1", "[::1]"];

/**
 * Whether `/dev-login` is on: only with DEV_LOGIN=true *and* on a local address,
 * so DEV_LOGIN set by mistake in production still can't let anyone sign in as anyone.
 */
export function devLoginEnabled(env: Pick<Env, "DEV_LOGIN">, url: URL): boolean {
  return env.DEV_LOGIN === "true" && localHosts.includes(url.hostname);
}

/**
 * Local development only (enabled by DEV_LOGIN=true, never in production):
 * sign in as any email without Cloudflare Access. `/dev-login` shows a form;
 * `/dev-login?email=…&next=/group/` sets the session cookie and goes to `next`.
 */
export async function devLogin(request: Request, secret: string | undefined): Promise<Response> {
  if (!secret) return new Response("Set SESSION_SECRET in .dev.vars", { status: 500 });

  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.trim();
  const next = safePath(url.searchParams.get("next"), url);
  if (!email) return form(next);

  return new Response(null, {
    status: 302,
    headers: { Location: next, "Set-Cookie": await sessionCookie(email, secret) },
  });
}

function form(next: string): Response {
  return new Response(
    `<!doctype html><title>Dev login</title>
<form>
  <h1>Dev login</h1>
  <p><label>Email <input name="email" type="email" required autofocus></label></p>
  <p><label>Then go to <input name="next" value="${escapeHtml(next)}"></label></p>
  <button>Sign in</button>
</form>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
