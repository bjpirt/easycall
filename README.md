# easyCall

A minimal video-calling app for someone who can't use ordinary video-call apps,
for example a relative in a care home.

The person being called (the _receiver_) has a tablet that needs no interaction
during a call. A member of staff opens the app and taps **Join call**. Family
members in the group can see the receiver is available, and the first one to join is connected
straight away; the receiver never has to answer. When the call ends, or if
nobody calls for a while, the tablet goes back to its idle screen.

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

## Setting up on Cloudflare

Everything runs on a free Cloudflare account. You'll need a Cloudflare account with
[Zero Trust](https://developers.cloudflare.com/cloudflare-one/) enabled (the free plan is
enough). Do these steps once, in order. Cloudflare rearranges its dashboard from time to time,
so labels may differ slightly.

### 1. Deploy the Worker

```sh
npx wrangler login   # opens a browser to authorise your Cloudflare account
npm run deploy       # builds and deploys, and prints the app's URL
```

The first deploy may ask you to choose a `workers.dev` subdomain. The app's URL is then
`https://easycall.<subdomain>.workers.dev`.

**Always deploy with `npm run deploy`**, never a bare `wrangler deploy`: it rebuilds first,
whereas the tests leave a test build in `dist/`.

### 2. Allow one-time PIN sign-in

In the Cloudflare dashboard, go to **Zero Trust → Integrations → Identity providers** and add
**One-time PIN**. Without it, PIN sign-in won't be offered as a login method in the next step.

### 3. Create the Access application for `/login`

Sign-in uses Cloudflare Access, but only on the `/login` path. The rest of the app checks its own
long-lived session, so devices like the tablet aren't asked to sign in again every time Access's
session expires.

1. Go to **Zero Trust → Access controls → Applications → Add an application → Self-hosted**.
2. **Name:** e.g. `easyCall login`. **Session duration:** anything (e.g. 24 hours); it only
   covers the sign-in itself.
3. **Public hostname:** subdomain `easycall`, domain `<subdomain>.workers.dev`, **path
   `login`**. Make sure the path is set: protecting the whole Worker would lock devices out
   whenever Access's session expired.
4. **Policy:** Action **Allow**, Include → **Emails** → every member's email (including the
   tablet's address).
5. **Login methods:** **One-time PIN** only. Turn on **Instant Auth** if offered, to skip the
   "choose a login method" screen.
6. Leave the other settings at their defaults and save.
7. Copy the application's **Audience (AUD) tag**: open the application, then **Configure →
   Additional settings → Application Audience (AUD) Tag**. It's 64 hexadecimal characters.
   (Cloudflare's guide: [Validate JWTs](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/).)

Your **team domain** is shown under **Zero Trust → Settings → Team name and domain**, e.g.
`yourteam.cloudflareaccess.com`.

### 4. Create a TURN key (for calls across networks)

Calls on mobile data and other restrictive networks need a relay. Go to **Realtime → TURN**
(formerly Calls) and create a TURN key. Note its **Key ID** and **API token**. Without it, calls
only connect where a direct connection is possible.

### 5. Set the secrets

```sh
npx wrangler secret put SESSION_SECRET       # paste a random value: openssl rand -base64 32
npx wrangler secret put ACCESS_TEAM_DOMAIN   # e.g. yourteam.cloudflareaccess.com (no https://)
npx wrangler secret put ACCESS_AUD           # the AUD tag from step 3
npx wrangler secret put TURN_KEY_ID          # from step 4
npx wrangler secret put TURN_KEY_API_TOKEN   # from step 4
npx wrangler secret put DIRECTORY            # groups and members (below)
npm run deploy
```

`DIRECTORY` lists each group, the name callers see for its receiver, and its members' roles
(`receiver`, `caller` or `admin`; exactly one receiver per group):

```json
{
  "groups": {
    "smith": {
      "displayName": "Grandma",
      "members": {
        "tablet@example.com": "receiver",
        "you@example.com": "admin",
        "sister@example.com": "caller"
      }
    }
  }
}
```

It can be pasted on one line. The group's URL is `https://easycall.<subdomain>.workers.dev/smith/`.
Every member's email must also be on the Access policy (step 3). Changing secrets takes effect
straight away; redeploying isn't needed.

### 6. Try it

Open `https://easycall.<subdomain>.workers.dev/<group>/` in a private window. You should be sent to
the Cloudflare sign-in page; enter your email and the emailed code, and you'll come back to the
group's page showing the view for your role. Sign the tablet in the same way, once, with its
address: its session then lasts a year and renews whenever the app is opened.

| What you see                           | Likely cause                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| "Sign-in isn't set up yet."            | `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` or `SESSION_SECRET` isn't set.                     |
| "Sign-in failed. Please try again."    | The AUD tag or team domain is wrong (check for a stray `https://` or `/`).            |
| No Cloudflare sign-in page             | The Access application doesn't cover `/login`: check its hostname and path.           |
| No PIN option, or no PIN email         | One-time PIN isn't enabled (step 2), the email isn't on the policy, or check spam.    |
| Signed in, but "Not found"             | Your email isn't in that group in `DIRECTORY`, or the group name in the URL is wrong. |
| Video doesn't connect between networks | The TURN secrets aren't set (step 4).                                                 |

## Development

```sh
npm run check    # type checks, lint, formatting and tests (must pass before committing)
npm test         # unit tests
npm run test:e2e # end-to-end tests (builds the app and serves it automatically)
npm run preview  # production build served locally
npm run format   # fix formatting
npm run types    # regenerate Worker types after changing wrangler.jsonc
```
