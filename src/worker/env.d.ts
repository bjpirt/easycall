// Secrets (set with `wrangler secret put`), optional so local dev and tests work
// without them. Merged into the generated `Env` in worker-configuration.d.ts.
interface Env {
  /** Groups (and, from step 14, members) as JSON; see src/worker/directory.ts. */
  DIRECTORY?: string;
  /** Signs session cookies. A long random string; rotating it signs everyone out. */
  SESSION_SECRET?: string;
  /** "true" enables /dev-login (local development only; never set in production). */
  DEV_LOGIN?: string;
  /** Cloudflare Realtime TURN key ID. Without it, calls use STUN only. */
  TURN_KEY_ID?: string;
  /** API token for the TURN key. */
  TURN_KEY_API_TOKEN?: string;
}
