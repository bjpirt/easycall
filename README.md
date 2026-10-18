# easyCall

A minimal video-calling app for someone who can't use ordinary video-call apps,
for example a relative in a care home.

The person being called (the _receiver_) has a tablet that needs no interaction
during a call. A member of staff opens the app and taps **Join call**. Family
members in the group get a notification, and the first one to join is connected
straight away; the receiver never has to answer. When the call ends, the tablet
waits for the next caller. If nobody calls for a while, it goes back to idle.

Each family group has its own URL. Everyone signs in with an emailed one-time
code, and their role in the group (receiver, caller or admin) decides what they
see.

It runs entirely on Cloudflare: a Worker serves the web app and API, a Durable
Object per group handles signalling and call state, and media goes peer-to-peer
over WebRTC with Cloudflare TURN as a fallback.

**Status:** early development. See [CLAUDE.md](CLAUDE.md) for the design and
build plan.

## Running locally

Requires Node 24 (see `.nvmrc`).

```sh
nvm use
npm install
cp .dev.vars.example .dev.vars   # local settings, including a "dev" group
npx playwright install chromium   # browser for end-to-end tests
npm run dev
```

To make a call locally, use two browser profiles (or a normal and a private window). Sign in
at <http://localhost:8787/dev-login> as `receiver@example.com` in one and `caller@example.com` in
the other, then open <http://localhost:8787/dev/> in both.

## Deploying

The app runs on Cloudflare Workers (the free plan is enough).

```sh
npx wrangler login   # once: opens a browser to authorise your Cloudflare account
npm run deploy       # builds and deploys; prints the app's workers.dev URL
```

The first deploy may ask you to choose a `workers.dev` subdomain.

Each family group has its own URL, `https://<your-worker>/<group>/`. Groups are configured in the
`DIRECTORY` secret, which isn't stored in the repo:

```sh
npx wrangler secret put DIRECTORY
# paste e.g. {"groups":{"smith":{"displayName":"Grandma","members":{"tablet@example.com":"receiver","you@example.com":"admin"}}}}
```

For calls to work across networks that block direct connections (e.g. mobile data), create a
TURN key in the Cloudflare dashboard (Realtime → TURN) and give the Worker its credentials:

```sh
npx wrangler secret put TURN_KEY_ID
npx wrangler secret put TURN_KEY_API_TOKEN
npm run deploy
```

Without them, calls fall back to direct (STUN-only) connections.

Sign-in uses Cloudflare Access (email one-time PIN) on the `/login` path only. Create a
self-hosted Access application for `<your-worker>/login`, allow the members' emails, then:

```sh
npx wrangler secret put SESSION_SECRET       # a long random string, e.g. openssl rand -base64 32
npx wrangler secret put ACCESS_TEAM_DOMAIN   # e.g. myteam.cloudflareaccess.com
npx wrangler secret put ACCESS_AUD           # the Access application's Audience (AUD) tag
npm run deploy
```

## Development

```sh
npm run check    # type checks, lint, formatting and tests (must pass before committing)
npm test         # unit tests
npm run test:e2e # end-to-end tests (starts wrangler dev automatically)
npm run preview  # production build served locally
npm run format   # fix formatting
npm run types    # regenerate Worker types after changing wrangler.jsonc
```
