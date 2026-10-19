/** True only under `npm run dev` (set in vite.config.ts). */
declare const __DEV_SERVER__: boolean;

/**
 * Security headers on everything the Worker serves (built assets and icons are
 * served by Cloudflare directly, so they don't pass through here).
 *
 * The Content-Security-Policy only lets pages load our own scripts, styles,
 * images and manifest, and connect back to us (the APIs and the room's
 * WebSocket); WebRTC media isn't covered by CSP. Pages can't be framed, so
 * nobody can overlay the app (and its Join Call button) on another site.
 */
export function contentSecurityPolicy(styleNonce?: string): string {
  return [
    "default-src 'none'",
    "script-src 'self'",
    // The dev server injects CSS as inline styles; built pages link it as a file.
    __DEV_SERVER__ ? "style-src 'self' 'unsafe-inline'" : styleSources(styleNonce),
    "img-src 'self'",
    "manifest-src 'self'",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const securityHeaders = {
  "Content-Security-Policy": contentSecurityPolicy(),
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  // Our own pages may ask for the camera and microphone; nothing else may.
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(), payment=()",
};

function styleSources(nonce: string | undefined): string {
  return nonce ? `style-src 'self' 'nonce-${nonce}'` : "style-src 'self'";
}

/** Adds the security headers (keeping any the response already set, such as a page's own CSP). */
export function withSecurityHeaders(response: Response): Response {
  if (response.webSocket) return response; // a WebSocket upgrade: nothing to secure
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (!secured.headers.has(name)) secured.headers.set(name, value);
  }
  return secured;
}
