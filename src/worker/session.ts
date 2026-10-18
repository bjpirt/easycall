/**
 * Our own session cookie, issued after sign-in: `<payload>.<signature>`, where
 * the payload is `{ email, exp }` and the signature is HMAC-SHA256 with
 * SESSION_SECRET. Uses only WebCrypto, so the E2E tests can mint cookies too.
 */

export const cookieName = "session";

/** Sessions last a year and are renewed whenever they're used. */
export const sessionSeconds = 365 * 24 * 60 * 60;

interface Payload {
  email: string;
  /** Expiry, in seconds since the epoch. */
  exp: number;
}

export async function sessionToken(
  email: string,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const payload: Payload = {
    email: email.trim().toLowerCase(),
    exp: Math.floor(now / 1000) + sessionSeconds,
  };
  const encoded = base64url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await key(secret),
    new TextEncoder().encode(encoded),
  );
  return `${encoded}.${base64url(new Uint8Array(signature))}`;
}

/** A `Set-Cookie` header value starting (or renewing) a session. */
export async function sessionCookie(
  email: string,
  secret: string,
  now = Date.now(),
): Promise<string> {
  const token = await sessionToken(email, secret, now);
  return `${cookieName}=${token}; Path=/; Max-Age=${String(sessionSeconds)}; HttpOnly; Secure; SameSite=Lax`;
}

/** The signed-in user's email, or `undefined` if there's no valid, unexpired session. */
export async function readSession(
  request: Request,
  secret: string | undefined,
  now = Date.now(),
): Promise<string | undefined> {
  if (!secret) return undefined;
  const token = cookie(request, cookieName);
  const [encoded, signature, extra] = token?.split(".") ?? [];
  if (!encoded || !signature || extra !== undefined) return undefined;

  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await key(secret),
      fromBase64url(signature),
      new TextEncoder().encode(encoded),
    );
    if (!valid) return undefined;
    const payload = JSON.parse(
      new TextDecoder().decode(fromBase64url(encoded)),
    ) as Partial<Payload>;
    if (typeof payload.email !== "string" || typeof payload.exp !== "number") return undefined;
    return payload.exp * 1000 > now ? payload.email : undefined;
  } catch {
    return undefined; // malformed base64 or JSON
  }
}

function cookie(request: Request, name: string): string | undefined {
  for (const part of request.headers.get("Cookie")?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
