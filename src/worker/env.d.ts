// Secrets (set with `wrangler secret put`), optional so local dev and tests work
// without them. Merged into the generated `Env` in worker-configuration.d.ts.
interface Env {
  /** Cloudflare Realtime TURN key ID. Without it, calls use STUN only. */
  TURN_KEY_ID?: string;
  /** API token for the TURN key. */
  TURN_KEY_API_TOKEN?: string;
}
