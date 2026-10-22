# easyCall

A minimal video-calling app for someone who can't use ordinary video-call apps,
for example a relative in a care home.

The person being called (the _receiver_) has a tablet that needs no interaction during a call. A member of staff opens the app and taps **Join Call**. Family members in the group can see the receiver is available, and the first one to join is connected straight away; the receiver never has to answer. When the call ends, or if nobody calls for a while, the tablet goes back to its idle screen.

Each family group has its own URL. Everyone signs in with an emailed one-time code, and their role in the group (receiver, caller or admin) decides what they see.

It runs entirely on Cloudflare: a Worker serves the web app and API, a Durable Object per group handles signalling and call state, and media goes peer-to-peer over WebRTC with Cloudflare TURN as a fallback.

**Status:** Working. See [CLAUDE.md](CLAUDE.md) for the decisions and build plan.

_If you have a loved one in a care home and think this would be useful for you too, please get in touch for an account so you can try it out._

## How it works

1. **Staff make the receiver available.** Someone with the receiver (care staff, say) opens easyCall on the receiver's tablet and taps **Join Call**. The tablet's camera comes on, and it waits for a call for up to 30 minutes. Staff can tap **End Call** to stop it waiting.
2. **Family see they can call.** On their phones or computers, members of the family group see "Grandma is ready for a call", and the **Join Call** button lights up.
3. **The first to join is connected.** The tablet answers by itself: it shows "Ben is calling…", then Ben's video fills the screen. There's nothing to tap on the tablet during a call.
4. **The call ends.** When Ben taps **End Call**, the tablet goes back to its first screen and shows "The call has ended." It stays unavailable until staff tap Join Call again. If nobody calls in time, it goes back by itself and shows "No calls just now."

Only one person can be in a call at a time: anyone else sees "Grandma is in a call with Ben". Calls reconnect after Wi-Fi drops, with both devices reconnecting by themselves. A caller who closes the app mid-call by mistake can tap **Re-join Call** to get back in. Everyone signs in once with a code sent to their email, and the app can be added to the home screen like any other app.

In these wireframes, "Grandma" is the receiver's name in the group and "Ben" is a caller.

### The receiver's tablet

```text
1. Idle                   2. Waiting for a call     3. In a call
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│                    │    │                    │    │                    │
│                    │    │  Waiting for a     │    │                    │
│                    │    │  call…             │    │    Ben's video,    │
│                    │    │                    │    │    full screen     │
│                    │    │                    │    │                    │
│  ┌──────────────┐  │    │                    │    │                    │
│  │  Join Call   │  │ -> │                    │ -> │                    │
│  └──────────────┘  │    │                    │    │                    │
│                    │    │ ┌──────────┐ ┌───┐ │    │              ┌───┐ │
│                    │    │ │ End Call │ │you│ │    │ Ben          │you│ │
│                    │    │ └──────────┘ └───┘ │    │              └───┘ │
│                    │    │                    │    │                    │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

### A caller's phone

```text
1. Not available          2. Ready for a call       3. In a call
┌────────────────────┐    ┌────────────────────┐    ┌────────────────────┐
│                    │    │                    │    │                    │
│  Grandma isn't     │    │  Grandma is ready  │    │                    │
│  available right   │    │  for a call        │    │  Grandma's video,  │
│  now               │    │                    │    │    full screen     │
│                    │    │                    │    │                    │
│  ┌──────────────┐  │    │  ┌──────────────┐  │    │                    │
│  │  Join Call   │  │ -> │  │  Join Call   │  │ -> │                    │
│  └──────────────┘  │    │  └──────────────┘  │    │ Grandma            │
│  (greyed out)      │    │                    │    │ ┌──────────┐ ┌───┐ │
│                    │    │                    │    │ │ End Call │ │you│ │
│  Signed in as Ben  │    │  Signed in as Ben  │    │ └──────────┘ └───┘ │
│                    │    │                    │    │                    │
└────────────────────┘    └────────────────────┘    └────────────────────┘
```

## Documentation

- [Design](docs/design.md): how the code fits together, with sequence diagrams of the main flows.
- [Acceptance tests](docs/manual-tests.md): step-by-step tests on real devices that anyone can run.

## Running locally

Requires Node 24 (see `.nvmrc`).

```sh
nvm use
npm install
cp .dev.vars.example .dev.vars   # local settings, including a "dev" group
npx playwright install chromium   # browser for end-to-end tests
npm run dev
```

To make a call locally, use two browser profiles (or a normal and a private window). Sign in at <http://localhost:8787/dev-login> as `receiver@example.com` in one and `caller@example.com` in the other, then open <http://localhost:8787/> in both (it takes you to the `dev` group).

## Setting up on Cloudflare

Everything runs on a free Cloudflare account. You'll need a Cloudflare account with [Zero Trust](https://developers.cloudflare.com/cloudflare-one/) enabled (the free plan is enough). Do these steps once, in order. Cloudflare rearranges its dashboard from time to time, so labels may differ slightly.

### 1. Deploy the Worker

```sh
npx wrangler login   # opens a browser to authorise your Cloudflare account
npm run deploy       # builds and deploys, and prints the app's URL
```

The first deploy may ask you to choose a `workers.dev` subdomain. The app's URL is then
`https://easycall.<subdomain>.workers.dev`.

**Always deploy with `npm run deploy`**, never a bare `wrangler deploy`: it rebuilds first, whereas the tests leave a test build in `dist/`.

### 2. Allow one-time PIN sign-in

In the Cloudflare dashboard, go to **Zero Trust → Integrations → Identity providers** and add **One-time PIN**. Without it, PIN sign-in won't be offered as a login method in the next step.

### 3. Create the Access application for `/login`

Sign-in uses Cloudflare Access, but only on the `/login` path. The rest of the app checks its own long-lived session, so devices like the tablet aren't asked to sign in again every time Access's session expires.

1. Go to **Zero Trust → Access controls → Applications → Add an application → Self-hosted**.
2. **Name:** e.g. `easyCall login`. **Session duration:** anything (e.g. 24 hours); it only covers the sign-in itself.
3. **Public hostname:** subdomain `easycall`, domain `<subdomain>.workers.dev`, **path `login`**. Make sure the path is set: protecting the whole Worker would lock devices out whenever Access's session expired.
4. **Policy:** Action **Allow**, Include → **Emails** → every member's email (including the tablet's address).
5. **Login methods:** **One-time PIN** only. Turn on **Instant Auth** if offered, to skip the "choose a login method" screen.
6. Leave the other settings at their defaults and save.
7. Copy the application's **Audience (AUD) tag**: open the application, then **Configure → Additional settings → Application Audience (AUD) Tag**. It's 64 hexadecimal characters. (Cloudflare's guide: [Validate JWTs](https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/).)

Your **team domain** is shown under **Zero Trust → Settings → Team name and domain**, e.g. `yourteam.cloudflareaccess.com`.

### 4. Create a TURN key (for calls across networks)

Calls on mobile data and other restrictive networks need a relay. Go to **Realtime → TURN** (formerly Calls) and create a TURN key. Note its **Key ID** and **API token**. Without it, calls only connect where a direct connection is possible.

### 5. Set the secrets

```sh
npx wrangler secret put SESSION_SECRET       # paste a random value: openssl rand -base64 32
npx wrangler secret put ACCESS_TEAM_DOMAIN   # e.g. yourteam.cloudflareaccess.com (no https://)
npx wrangler secret put ACCESS_AUD           # the AUD tag from step 3
npx wrangler secret put TURN_KEY_ID          # from step 4
npx wrangler secret put TURN_KEY_API_TOKEN   # from step 4
npm run deploy
```

Then set up the **directory**: the groups and their members. Each member has a role (`receiver`, `caller` or `admin`) and a name, which the others see on screen. Every group has exactly one receiver, and the receiver's name is what callers see the group as ("Call Grandma"). It lives in a local `directory.json`, which is gitignored so members' emails never reach the repo:

```sh
cp directory.example.json directory.json   # then edit it
npm run directory:push                      # checks it, then uploads it as the DIRECTORY secret
```

```json
{
  "groups": {
    "smith": {
      "members": {
        "tablet@example.com": { "role": "receiver", "name": "Grandma" },
        "you@example.com": { "role": "admin", "name": "Ben" },
        "sister@example.com": { "role": "caller", "name": "Sarah" }
      }
    }
  }
}
```

The group's key (`smith`) is its URL: `https://easycall.<subdomain>.workers.dev/smith/`. A name can differ between groups. `directory:push` checks the file with the same rules as the app and uploads nothing if it finds mistakes (a missing name, an unknown role, a group without exactly one receiver, and so on). Use `npm run directory:push -- --check` to check without uploading. Afterwards it lists every member's email: each must also be allowed by the Access policy (step 3). To add or remove someone, edit `directory.json`, run `npm run directory:push` again, and update the Access policy. Changes take effect straight away; redeploying isn't needed.

### 6. Try it

Open `https://easycall.<subdomain>.workers.dev/<group>/` in a private window. You should be sent to the Cloudflare sign-in page; enter your email and the emailed code, and you'll come back to the group's page showing the view for your role. Sign the tablet in the same way, once, with its address: its session then lasts a year and renews whenever the app is opened.

| What you see                           | Likely cause                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| "Sign-in isn't set up yet."            | `ACCESS_TEAM_DOMAIN`, `ACCESS_AUD` or `SESSION_SECRET` isn't set.                     |
| "Sign-in failed. Please try again."    | The AUD tag or team domain is wrong (check for a stray `https://` or `/`).            |
| No Cloudflare sign-in page             | The Access application doesn't cover `/login`: check its hostname and path.           |
| No PIN option, or no PIN email         | One-time PIN isn't enabled (step 2), the email isn't on the policy, or check spam.    |
| Signed in, but "Not found"             | Your email isn't in that group in `DIRECTORY`, or the group name in the URL is wrong. |
| Video doesn't connect between networks | The TURN secrets aren't set (step 4).                                                 |

### Installing the app

Each group's page can be installed as an app (Chrome: **Install app** or **Add to Home screen** in the menu; iPhone Safari: **Share → Add to Home Screen**). Sign in first: the app depends on your role. On the tablet it opens full screen; for callers it's called "Call" plus the receiver's name.

### 7. Automatic deploys

GitHub Actions deploys `main` to Cloudflare whenever the checks pass (`.github/workflows/check.yml`). It needs two repository secrets:

1. **Cloudflare API token:** in the Cloudflare dashboard, open **My Profile → API Tokens → Create Token**, use the **Edit Cloudflare Workers** template, set **Account Resources** to your account (and **Zone Resources** to all zones, which the template requires), then create it and copy the token.
2. **Cloudflare account ID:** shown by `npx wrangler whoami`, or on your account's overview page in the dashboard.
3. Add both to the GitHub repository (**Settings → Secrets and variables → Actions**), or with the GitHub CLI:

   ```sh
   gh secret set CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID
   ```

After that, every push to `main` deploys once the checks pass. To redeploy without a new commit, use **Actions → Check and deploy → Run workflow** on `main`. The app's secrets (`DIRECTORY` etc.) stay in Cloudflare and aren't affected by deploys.

## Acceptance tests

Real devices and networks are checked by hand, with step-by-step tests anyone can run: see [docs/manual-tests.md](docs/manual-tests.md).

## Development

How the code is designed (architecture, the room's rules, and sequence diagrams of the main flows) is described in [docs/design.md](docs/design.md).

```sh
npm run check    # type checks, lint, formatting and tests (must pass before committing)
npm test         # unit tests
npm run test:e2e # end-to-end tests (builds the app and serves it automatically)
npm run preview  # production build served locally
npm run format   # fix formatting
npm run types    # regenerate Worker types after changing wrangler.jsonc
npm run icons    # re-render public/icons/*.png after changing scripts/icon.svg
```
