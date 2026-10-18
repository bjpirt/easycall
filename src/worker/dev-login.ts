import { safePath } from "./safe-path";
import { sessionCookie } from "./session";

/**
 * Local development only (enabled by DEV_LOGIN=true, never in production):
 * sign in as any email without Cloudflare Access. `/dev-login` shows a form;
 * `/dev-login?email=…&next=/group/` sets the session cookie and goes to `next`.
 */
export async function devLogin(request: Request, secret: string | undefined): Promise<Response> {
  if (!secret) return new Response("Set SESSION_SECRET in .dev.vars", { status: 500 });

  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.trim();
  const next = safePath(url.searchParams.get("next"));
  if (!email) return form(next);

  return new Response(null, {
    status: 302,
    headers: { Location: next, "Set-Cookie": await sessionCookie(email, secret) },
  });
}

function form(next: string): Response {
  const escaped = next.replace(/[&"<>]/g, (c) => `&#${String(c.charCodeAt(0))};`);
  return new Response(
    `<!doctype html><title>Dev login</title>
<form>
  <h1>Dev login</h1>
  <p><label>Email <input name="email" type="email" required autofocus></label></p>
  <p><label>Then go to <input name="next" value="${escaped}"></label></p>
  <button>Sign in</button>
</form>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}
