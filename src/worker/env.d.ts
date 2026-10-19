// Secrets (set with `wrangler secret put`), optional so local dev and tests work
// without them. Merged into both generated `Env` types in worker-configuration.d.ts.
interface Secrets {
  /** Groups and their members, as JSON; see src/worker/directory.ts. */
  DIRECTORY?: string;
  /** Signs session cookies. A long random string; rotating it signs everyone out. */
  SESSION_SECRET?: string;
  /** "true" enables /dev-login (local development only; never set in production). */
  DEV_LOGIN?: string;
  /** Cloudflare Access team domain, e.g. "myteam.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** Audience (AUD) tag of the Access application that guards /login. */
  ACCESS_AUD?: string;
  /** Cloudflare Realtime TURN key ID. Without it, calls use STUN only. */
  TURN_KEY_ID?: string;
  /** API token for the TURN key. */
  TURN_KEY_API_TOKEN?: string;
}

interface Env extends Secrets {}

declare namespace Cloudflare {
  interface Env extends Secrets {}
}
