# easyCall

## What this is

A very simple video-calling system so family can call a family member in care who can't operate normal video apps (mainstream video apps are too complex). The person being called (the **receiver**) must never need to touch the screen. Built to support several family **groups**, each with their own receiver.

## How it works (agreed model)

1. Care home staff open the app on the receiver's Android tablet (already set up with a simple launcher). The tablet runs **Chrome on Android**, and that's the target browser for the receiver view. The app opens on the **idle** screen.
2. Staff tap **Join call**. That is the "ready" signal and the consent. The receiver's camera turns on (self-view in the corner), the tablet connects to the group's room and the receiver is marked **available** (receiver state: _in call, waiting_).
3. Callers with the app open see that the receiver is available ("{displayName} is ready for a call"). (Notifications are deferred as a maybe.)
4. The first caller to press their **Join call** is connected automatically, with no answering on the receiver's side. The caller's video goes full screen and the receiver's self-view stays in the corner (_in call, active_).
5. When the caller hangs up, the receiver goes back to **idle** (camera off, unavailable) showing "The call has ended." with the Join call button. Staff tap Join call to make the receiver available again.
6. If nobody calls within the ready window, the receiver goes back to **idle**: camera off, disconnected, **unavailable**.

### Screen states (agreed)

- **Receiver:** _idle_ (big "Join call" button) → _in call_, which is either _waiting_ (own camera in the corner, available) or _active_ (caller video full screen + own camera in the corner).
  - Caller hangs up → _idle_ with "The call has ended." (agreed in step 12, replacing the earlier "back to waiting"). Ready-window timeout → _idle_ with "No calls just now."
- **Caller:** same layout: _idle_ with a "Join call" button that's **only enabled while the receiver is waiting** → _in call, active_. Callers never wait in the room. Hang up → _idle_. After hanging up, the caller's idle screen is quiet (status + Join call, no message).
- A web page can't reliably close itself, so the app never "closes"; _idle_ is the resting state.

## Requirements

- No outgoing calls from the receiver (for now).
- No interaction needed on the tablet during a call. Once joined, the page has nothing to tap.
- Staff tapping **Join call** is the "ready" signal and the consent. The camera is only on, and can only connect, while the receiver is joined.
- **Ready-window timeout:** if nobody calls within ~20–30 min (configurable) of joining or of the last call ending, go back to _idle_.
- **Hidden staff exit:** deferred as a maybe (see Deferred / later). For now staff leave the app (e.g. Home) and the ready-window timeout returns it to idle.
- Only one caller connected at a time.
- Users and their roles managed simply; minimal custom auth code (Access does identity).
- Everything updatable remotely; the owner can't easily visit the tablet.
- Recovers by itself from Wi-Fi drops (care home Wi-Fi may be flaky or locked down).
- **Clean vs unclean exit (agreed):** handle them differently.
  - **Clean:** someone deliberately hangs up. The client sends an explicit `hangup` message, and the call ends immediately (caller → quiet idle, receiver → idle with "The call has ended.").
  - **Unclean:** the connection is lost (socket closes or drops without a `hangup`, or the media connection fails). Don't end the call straight away: hold the call and the caller's slot for a short grace period while both sides try to reconnect/recover, then end it if they don't come back.
  - Rely on the explicit message, not WebSocket close codes / `wasClean`, which aren't trustworthy across networks.

## Groups, users and roles (agreed)

- **Group:** has a slug, which is its URL: `/<group>/`. **Everyone in the group uses the same URL.** There's no separate tablet URL.
- **Group display name** (agreed): each group has a `displayName` for the person being called (e.g. "Grandma"), used in the UI ("{displayName} is ready for a call").
- **Ready window** (agreed): one app-wide setting (env var), default 30 minutes. Not per group.
- **Membership:** (user email, group, role). Roles:
  - **receiver:** the person being called, on the tablet. Shows the receiver view (auto-answer, full screen).
  - **caller:** family. Shows the caller view.
  - **admin:** can manage the group, and can do everything a caller can.
- **One role per user per group** (agreed). A user can belong to several groups.
- **Exactly one receiver per group** (agreed). A second person to call = a second group.
- The page asks the Worker "who am I in this group?" and renders the matching view. Non-members get a 404.
- **The receiver is an ordinary user.** It logs in the same way as everyone else. No separate device/pairing records.
- **Storage:** start with a JSON env var/secret; move to **D1** later, with an admin UI to assign users roles on groups. Code reads through a small `Directory` interface so the storage swap doesn't touch the rest of the app.
- Each group gets its own Durable Object room (`idFromName(groupSlug)`): state and calls are fully separate per group.

## Auth (agreed)

- **Identity:** Cloudflare Access email one-time PIN. No Google/other identity providers.
- **Access only guards `/login`.** After the PIN login, the Worker verifies the Access JWT (`Cf-Access-Jwt-Assertion`, `jose`, team JWKS + AUD) and issues its **own long-lived, signed, HttpOnly session cookie** for that email. This avoids Access's 1-month max session (the tablet would otherwise show a PIN screen roughly monthly).
- All other routes bypass Access and check our cookie, then look up the user's role for the group in the URL.
- **Session cookie** (agreed default): 1-year lifetime, renewed whenever it's used.
- Revocation: remove the user from the directory (roles are checked on every request), or rotate the signing key to sign everyone out.
- **Access allow-list:** who can get a PIN. It's auto-synced on deploy from the users directory by a CI script using a Cloudflare API token (with Access edit permission). One source of truth.

## Architecture (Cloudflare)

- **Hosting (agreed):** a single Worker with static assets serves the pages, the API and the Durable Objects. No Cloudflare Pages.
- **Domain (agreed):** start on `<name>.workers.dev`; may move to a custom domain later (the tablet bookmark/install and family PWA installs would need redoing).
- **Worker + one Durable Object ("room") per group**
  - Holds WebSocket connections from receiver and callers (signalling).
  - Tracks availability state, enforces single caller and the ready-window timeout (DO alarm).
  - Issues short-lived Cloudflare TURN credentials.
- **Media:** peer-to-peer WebRTC with **Cloudflare Realtime TURN** as fallback. The caller always offers and the receiver always answers. Swap to Realtime SFU later only if multi-party calls are wanted. (Pricing: $0.05/GB egress after 1,000 GB/month free, shared with SFU; expected usage is well inside the free tier.)
- **Web app** (static assets on the Worker, installable PWA). One app, with the view chosen by role:
  - **Caller view:** own camera in the corner during a call (same layout as the receiver). Shows available / not available; Join call button only enabled when the receiver is waiting.
  - **Receiver view:** full screen. Follows the screen states above: _idle_ → Join call → _waiting_ → auto-accepts the incoming call → _active_ → call ends → _idle_; timeout → _idle_.

## Code structure (proposed)

- `src/shared/`: protocol message types + type guards.
- `src/worker/`: routing, auth, directory, TURN; `room.ts` is a thin DO shell over a pure `room-state.ts` state machine that returns new state + effects.
- `src/client/`: shared lib (reconnecting socket, peer wrapper) + caller and receiver views.
- Principle: keep logic pure and testable; DO/DOM/WebRTC code are thin adapters.
- **UI approach (agreed by default):** no framework. Plain DOM + TypeScript: each view has a `State` union and a `render(state)` that rebuilds its content with `replaceChildren`, plus small `element` / `video` helpers in `dom.ts`. Plain CSS in `style.css`. Revisit only if the UI grows enough to justify a framework.
- **Routing (steps 13, 18):** `src/worker/index.ts`. `/login` and `/dev-login` (see below). `/<group>` → 301 to `/<group>/` (query kept). Group routes need a **member's session** (`authenticate()` → `member` / `signed-out` / `not-member`):
  - `/<group>/` → the app (`env.ASSETS.fetch("/")`, the same page for every role). Signed out → **302 to `/login?next=<path+query>`**. Not a member → 404.
  - `/<group>/api/me`, `/<group>/api/ice-servers` (`no-store`), `/<group>/api/room` (WebSocket): signed out → 401; not a member → 404.
  - **The room's role comes from the directory** (`roomRole(member.role)`): the Worker rewrites the DO request's query to `?role=…`, ignoring anything the browser sent. DOs aren't publicly reachable, so the room can trust it.
  - Everything else, including `/` and unknown groups, is a 404. `wrangler.jsonc` `assets`: `binding: "ASSETS"`, `run_worker_first: ["/*", "!/assets/*", "!/icons/*"]` (the Worker checks the group first; built assets and icons skip it). The client's room and ICE URLs are relative to the page (`new URL("api/room", page)`).
- **Directory (steps 13–14):** `src/worker/directory.ts` `parseDirectory(env.DIRECTORY)` → `Directory` with `group(slug)` and `role(slug, email)`. `DIRECTORY` is a **secret** (never committed; the repo is public): JSON like `{"groups":{"smith":{"displayName":"Grandma","members":{"tablet@example.com":"receiver","ben@example.com":"admin"}}}}`. Emails are case-insensitive. Invalid members are skipped; a group with more than one receiver is skipped entirely. Roles (`src/shared/roles.ts`): `MemberRole` = `receiver` / `caller` / `admin`; `roomRole()` maps `admin` → `caller` in the room. Slugs match `slugPattern` (lowercase letters, digits, inner hyphens). Invalid groups are skipped and a missing or invalid directory is empty (logged). Read only through the `Directory` interface (D1 later). **Managed as a local file (step 21):** `directory.json` (gitignored; `directory.example.json` shows the format) is uploaded with `npm run directory:push` (`scripts/push-directory.ts`, run with `tsx`). It validates with `directoryProblems()` (the same rules as the Worker; `parseDirectory` reports problems through an `onProblem` callback, logged by default), uploads nothing if there are mistakes, sends the JSON to `wrangler secret put DIRECTORY` on stdin, then prints `Directory.emails()` to check against the Access policy. `--check` validates only.
- **Room (steps 5, 9, 11, 23):** `src/worker/room-state.ts` is a **pure state machine**. `RoomState` = `{ receiver, callers, active }`, where `receiver` and `active` (the caller in the call) are **participants** `{ email, connection }`, and `callers` are connected callers' connection ids. (A participant's `connection` is null while they're away.) Transitions `connect` / `receive` / `disconnect` / `expire(timer)` return `{ state, effects }` (`send` a message, `close` a connection with a reason, or start or stop a named `timer`), plus `status(state)`. Rules:
  - Everyone who connects is sent `welcome { resumed }` first; callers then get the status. Status changes go to every caller.
  - `join` from a caller succeeds only if the receiver is connected and nobody is in the call (room replies `joined`); otherwise `refused` (step 10).
  - Signals flow only between the receiver and the active caller (by current connection); anything else is dropped.
  - **Clean exit:** `hangup` from the active caller ends the call (`endCall`): the receiver is sent `hangup` and closed (back to idle), so callers go straight to `unavailable`.
  - **Unclean exit (step 23):** a participant's connection closing without a hang-up marks them **away** (connection null) and starts a grace timer (`caller-away` / `receiver-away`). Status doesn't change, so callers see no blip. **Reconnecting with the same email within the grace period** takes their place back (`welcome { resumed: true }`) and the call carries on: a caller is matched by email to the away active caller, and the receiver by email to the receiver. A receiver reloading while still connected replaces the old connection but keeps their place. When a grace timer runs out: an away caller → `endCall`; an away receiver → gone (the caller is sent `hangup`, status `unavailable`). A _different_ receiver connecting replaces the old one and ends any call.
  - **Ready window (step 11):** the `ready` timer runs while the receiver is waiting (present or away, no call). It restarts only when a different receiver takes over. On expiry, the receiver gets `timeout`, is closed, and is cleared.
  - Timers follow their conditions: `finish()` compares before and after and emits start or stop effects, so the state machine needs no clock.
- `src/worker/room.ts` is the thin DO shell (WebSocket Hibernation API). Each socket's attachment holds its `{ id, role, email }` (the Worker passes `role` and `email` from the directory and session) and is tagged with its id. State is saved in `ctx.storage.kv` (`state`). **Timers** are deadlines in kv (`timers`), with one DO alarm set for the earliest; `alarm()` expires every due timer in deadline order. Durations: `ready` = `READY_WINDOW_MINUTES`, grace = `GRACE_SECONDS` (default 30; `timerMs`). On load, participants and callers whose connection isn't live are dropped (sockets don't survive a restart), except participants already away, who wait for their timer. Close effects use code 4000 (the client doesn't retry 4000+). Bound as `ROOM` (SQLite-backed DO, migration `v1`). Room tests address a fresh DO per test and force a timer with `runOut(name)` (set its deadline to 0, then `runDurableObjectAlarm`). `src/shared/roles.ts` defines `Role` + `isRole`.
- **Sessions (step 15):** `src/worker/session.ts`. Cookie `session` = `base64url({email, exp}).base64url(HMAC-SHA256)` signed with the `SESSION_SECRET` secret; `HttpOnly; Secure; SameSite=Lax; Path=/`, 1 year. `readSession(request, secret)` → email or `undefined` (verifies with `crypto.subtle.verify`, checks expiry). WebCrypto only, so E2E mints cookies with the same code. Rotating `SESSION_SECRET` signs everyone out; removing a user from the directory removes access (roles are checked on every request).
- **Who am I (step 15):** `GET /<group>/api/me` → `{ email, role, displayName }` (`src/shared/me.ts` `Me` / `parseMe`), `no-store`, and renews the session cookie. **401** if not signed in, **404** if signed in but not a member.
- **Dev login (step 15):** `/dev-login` (`src/worker/dev-login.ts`) exists **only when `DEV_LOGIN=true`** (set in `.dev.vars`, never in production; an E2E test checks it's a 404 in the built app). It shows a form; `?email=…&next=/group/` sets the cookie and redirects. `next` is limited to same-site paths (`safePath`).
- **Access login (step 17):** `/login?next=…` (`src/worker/login.ts`) is the only path guarded by Cloudflare Access (email one-time PIN). It verifies `Cf-Access-Jwt-Assertion` with `jose` (`src/worker/access.ts` `verifyAccess`: RS256 against `https://<ACCESS_TEAM_DOMAIN>/cdn-cgi/access/certs`, issuer `https://<ACCESS_TEAM_DOMAIN>`, audience `ACCESS_AUD`, and it must have an `email`, so service tokens are rejected), then sets our session cookie and redirects to `safePath(next)` (`src/worker/safe-path.ts`). No valid token → 401; missing config → 500. With `DEV_LOGIN=true` it redirects to `/dev-login`. Tests use a local fake Access team (`access-test-keys.ts`: a generated RSA key, signs tokens with `jose`). `jose` is the only runtime dependency.
- **Installable app (step 31):** `/<group>/manifest.webmanifest` (`src/worker/manifest.ts`) needs a member's session. The page links it relatively with `crossorigin="use-credentials"`, so the browser sends the cookie. It's **per group** (`id` / `start_url` / `scope` = `/<group>/`) and **per role**: receiver → `display: fullscreen`, name "easyCall"; caller or admin → `standalone`, "Call {displayName}". Served `no-store`. Icons are in `public/icons/` (192, 512 also used as maskable, and an apple-touch-icon), rendered from `scripts/icon.svg` with `npm run icons` (Playwright screenshots; the PNGs are committed). No service worker: current Chrome doesn't need one to install. The receiver view also requests full screen on Join call (where `document.fullscreenEnabled`). **Chrome's installability check returns nothing in headless Playwright** (it reports no errors even with no manifest), so E2E only checks the manifest Chrome fetched; whether it offers to install is checked on real devices (step 35).
- **TURN (step 22):** `src/worker/turn.ts` `iceServers(env, fetch)` POSTs to `https://rtc.live.cloudflare.com/v1/turn/keys/{TURN_KEY_ID}/credentials/generate-ice-servers` (Bearer `TURN_KEY_API_TOKEN`, `ttl` 24 h). It falls back to `stunOnly` if the secrets are missing (local dev, tests) or the API fails. `src/shared/ice.ts` has `IceServer`, `stunOnly` and `parseIceServers` (validates, and drops port-53 URLs, which browsers block). The client (`src/client/ice.ts` `fetchIceServers(page)`, from `/<group>/api/ice-servers`) fetches fresh servers when Join is pressed, in parallel with the camera, and passes them to `createPeer` (`PeerOptions.iceServers`). The secrets are declared optional in `src/worker/env.d.ts` (not `secrets.required`, which would make them mandatory locally).
- **Protocol (steps 7–9):** `src/shared/protocol.ts` defines `Signal` (`offer` / `answer` / `candidate`, for the peer connection), `Status` (`unavailable` / `available` / `in-call`) and `Message` (everything on the room socket: `Signal` | `hangup` | `join` | `joined` | `refused` | `timeout` | `welcome { resumed }` | `status`), plus `parseMessage` (validates untrusted JSON; unknown fields dropped).
- **Client (steps 6–9):**
  - `peer.ts`: `createPeer` wraps `RTCPeerConnection` (STUN `stun.cloudflare.com:3478`). The caller always offers and the receiver always answers. Incoming signals are processed strictly in order through a queue (so candidates wait for the offer), and one failed signal doesn't block later ones. `restart()` sends an ICE-restart offer (`createOffer({ iceRestart: true })`), and `onConnectionState` reports `connectionstatechange` (step 24).
  - `room-connection.ts` (step 23): `openRoom(connect, { onMessage, onReconnecting, onClosed })` → `{ send, close }`. Reconnects after an unexpected close, waiting 1, 2, 4, 8 and then 15 s (`retryDelays`; resets on `welcome`). A close with code ≥ 4000 means the room closed it on purpose: `onClosed`, no retry. `send` silently drops while not connected.
  - `receiver-session.ts`: `receiverStarter(deps)` turns on the camera (and fetches ICE servers), then opens the room. `welcome` → `waiting` (first time). Answers offers. `hangup` → ended "The call has ended."; `timeout` → "No calls just now."; closed for good → "This screen was opened somewhere else." A drop → `connection: reconnecting`; after reconnecting, `welcome { resumed: false }` while in a call ends it. `leave()` (unused) closes without retrying. Note: the room would then treat it as a drop (grace period), not a clean exit.
  - `caller-session.ts`: `connectCaller(deps, onEvent)` opens the room **when the page loads** and reports `status` and `connection` (`connected` / `reconnecting` / `closed`). `join()` (only once welcomed) turns on the camera, sends `join`, and offers only after `joined`; `refused` ends with an explanation. **Clean exit:** `hangUp()` sends `hangup`, stops the camera and closes the peer but keeps the connection (still watching availability); a hang-up while the camera is starting cancels the join. **Drops (step 23):** the call carries on while reconnecting; `welcome { resumed: false }` afterwards ends it ("The call has ended."); closed for good ends any call. **Call recovery (step 24):** the caller (who makes all offers, so there's no glare) restarts ICE when the peer connection is `failed`, after `restartAfterMs` (3 s) of `disconnected` (cancelled if it recovers), and on `welcome { resumed: true }` (the network may have changed). The receiver answers restart offers like any other. This also recovers a call after the tablet page reloads, because Chrome accepts the new page's DTLS fingerprint on an ICE restart.
  - `receiver-view.ts` / `caller-view.ts`: separate views now that they've diverged. Receiver: `idle` → `joining` → `waiting` → `active`, with nothing to tap once joined. Caller: `idle` shows the status using the group's display name ("Connecting…", "Grandma isn't available right now", "Grandma is ready for a call", "Grandma is in a call", or lost connection) with **Join call enabled only when `available`**; then `joining` → `calling` (self-view + Hang up) → `active` (remote full screen + self-view + Hang up). Status changes don't interrupt a call. After a clean hang-up the caller's idle screen is quiet; a `call-ended` with a reason shows it as a `message` (field renamed from `error`).
  - **Connection status (step 25):** `call-status.ts`: `MediaState` = `connecting` (until media first flows) / `connected` / `interrupted` (recovering), mapped from `connectionstatechange` by `mediaState(state, connectedBefore)`. `callNotice(media, roomReconnecting)` gives "Connecting…" / "Reconnecting…" / nothing. Both sessions emit `media` events. Both call screens show the notice in a **persistent `.notice` element updated in place** (rebuilding the videos would make them flash); the caller's calling screen shows "Calling…" or "Reconnecting…". **Give-up (caller only):** if a call has no working media for `giveUpAfterMs` (30 s) after `joined`, or after being interrupted, the caller sends `hangup` and ends it with "Couldn't connect. Please try again." (never connected) or "The call was cut off." The timer is cleared when media connects.
  - **Screen wake lock (step 32):** `wake-lock.ts` `keepAwake()` takes a Screen Wake Lock and returns a release function. Browsers drop the lock when the page is hidden, so it's taken again on `visibilitychange` (never two at once). Refusals (e.g. battery saver) and unsupported browsers are ignored. The receiver view holds it while `waiting` / `active`, and the caller view while `calling` / `active`; both release it on idle, so devices can sleep. The views take the helper as an optional parameter for tests. The E2E test fakes `navigator.wakeLock`, since headless Chromium can't hold one. If the real tablet's launcher or battery saver overrides it, the Stage 2 wrapper can use Android's `FLAG_KEEP_SCREEN_ON`.
  - `signalling.ts`: `RoomSocket` type, `sendMessage` / `onMessage`, `stopCamera`. `dom.ts`: `element` and `video` helpers. `test-fakes.ts`: shared fakes (socket, camera, peer). The caller view shows "Reconnecting…" or "Disconnected…" on its idle screen.
  - `main.ts` (step 16): calls `/<group>/api/me` (`src/client/me.ts` `fetchMe` → `member` / `signed-out` / `not-member` / `error`) and mounts the receiver view if `roomRole(role)` is `receiver`, otherwise the caller view (with the group's `displayName`). Signed out → "Please sign in to continue." with a link to `/login?next=<path>`; not a member → a message saying so. The `?role=` switch is gone. Pages live at `/<group>/`.

## Tooling

- **In place (step 1):** TypeScript 6 (strict + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint 10 + typescript-eslint `strictTypeChecked` + `stylisticTypeChecked` (`eslint-config-prettier` turns off style rules), Prettier (print width 100), markdownlint-cli2 (prettier-compatible style), Vitest 5.
- Scripts: `typecheck`, `lint` (ESLint + markdownlint), `format` / `format:check`, `test` (Vitest), `test:e2e` (Playwright), and **`check`** (all of them, E2E included; this is the definition of done). Run `npm run format` to fix formatting.
- **Build/dev (step 6):** Vite 8 + `@cloudflare/vite-plugin` runs the Worker (in workerd) and the client together. `index.html` (root) → `src/client/main.ts`. `npm run dev` = `vite dev` on port 8787; `npm run build` = `vite build` (client + Worker into `dist/`); `npm run preview` = build + `vite preview`. `wrangler.jsonc` has no `assets.directory`: the plugin fills it in at build time. `worker-configuration.d.ts` is generated by `npm run types` and committed; `typecheck` runs `wrangler types --check` so it can't drift. Rerun `npm run types` after changing `wrangler.jsonc`.
- **Local config:** copy `.dev.vars.example` to `.dev.vars` (gitignored) for `npm run dev`; it defines a `dev` group (members `receiver@`, `caller@` and `admin@example.com`), `SESSION_SECRET` and `DEV_LOGIN=true`. Sign in at `http://localhost:8787/dev-login` (e.g. as `receiver@example.com` in one browser profile and `caller@example.com` in another), then open `http://localhost:8787/dev/`. `wrangler.jsonc` has `secrets.required: []`, so `wrangler types` doesn't infer secrets from `.dev.vars` (generated types are identical locally and in CI); secrets are typed as optional in `src/worker/env.d.ts`. `vite.config.ts` overrides `READY_WINDOW_MINUTES`, `DIRECTORY` and `SESSION_SECRET` from env vars when set (used by E2E).
- **Config (steps 11, 23):** `GRACE_SECONDS` (wrangler `vars`, default `"30"`; how long a dropped participant's place is held). `READY_WINDOW_MINUTES` (wrangler `vars`, default `"30"`; parsed by `readyWindowMs`, and anything invalid or ≤ 0 falls back to 30). `vite.config.ts` overrides it from the `READY_WINDOW_MINUTES` env var when set; the Playwright web server sets `0.1` (6 s) so the timeout can be tested. The E2E build bakes these test values (ready window, directory, session secret) into `dist/`, so **always deploy with `npm run deploy`** (it rebuilds), never a bare `wrangler deploy`. The session secret is random per run, so even an accidental deploy of a test build can't expose a known secret. Don't reuse a preview server on 8788 that was started without these settings.
- **Unit tests:** colocated `*.test.ts`, as two Vitest projects. **worker** (`src/worker`, `src/shared`) runs inside workerd via `@cloudflare/vitest-plugin`; call the Worker with `exports.default.fetch()` from `cloudflare:workers`. These **bypass static-asset routing**, so pages are covered by E2E. **client** (`src/client`) runs in happy-dom; note that happy-dom's `MediaStream` lacks `getTracks()`.
- **TypeScript projects:** `tsconfig.base.json` (shared strict options); `tsconfig.worker.json` (`src/worker`, `src/shared`, Workers types, no DOM); `tsconfig.client.json` (`src/client`, `src/shared`, DOM + `vite/client`); `tsconfig.node.json` (`e2e/`, `scripts/` and the root config files, DOM + Node types; was `tsconfig.e2e.json`). The root `tsconfig.json` just references them (for editors/ESLint).
- **E2E (step 3):** Playwright 1.64, Chromium only (matches the tablet), against the **built** app (`npm run build && vite preview`) on port 8788 (started automatically; reused locally if already running, so stop a stale one after changing code). Tests live in `e2e/*.spec.ts`. **Runs in parallel; each worker rotates through its own few groups** (`e2e-<parallelIndex>-<0..3>`, listed in the web server's `DIRECTORY`; `e2e/config.ts`). The `group` fixture picks the worker's least recently used group and waits if it was used within the grace period, because a room holds a dropped participant's place, so a test must not inherit the previous test's away participants. The test server runs with `GRACE_SECONDS` 3. `dropConnection(page)` closes the page's latest WebSocket (fixtures record them with an init script) to simulate a network blip. The web server's readiness URL is the first group's `/api/me` `e2e/config.ts` holds the test server's settings (port, a **random per-run** `SESSION_SECRET` (set once in `playwright.config.ts` as `E2E_SESSION_SECRET` and inherited by the workers), group members `receiver@` / `caller@` / `other-caller@` / `admin@e2e.test`), shared with `playwright.config.ts`. `signIn(page, email)` adds a session cookie minted with the real signing code; the `receiver` / `caller` / `otherCaller` fixture pages are signed in as those users automatically. `e2e/fixtures.ts` provides `receiver` and `caller` pages, each in its own browser context with a fake camera/mic and permissions granted. One-off setup: `npx playwright install chromium`. Chromium is launched with `--allow-loopback-in-peer-connection`: without it, local WebRTC E2E fails on macOS with the firewall in stealth mode, because LAN UDP to the unsigned test browser is dropped (ICE sticks at `checking`).
- **CI (step 4) and deploy (step 20):** `.github/workflows/check.yml` ("Check and deploy") runs on every push, PR and manual dispatch. Job `check`: `npm ci`, installs Chromium, runs `npm run check`, and uploads the Playwright report on failure. Job `deploy`: `needs: check`, only on `main` (not PRs), runs `npm run deploy` on a fresh runner (always a clean production build) with the `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` repository secrets. It uses concurrency group `deploy` (no overlapping deploys) and environment `production`. Node comes from `.nvmrc`.
- **Gitignore gotcha:** the owner's global gitignore has `Icon*` (for macOS Icon files), which also matches `icon-192.png` and `icon.svg` because macOS file names are case-insensitive. The repo's `.gitignore` re-includes `public/icons/` and `scripts/icon.svg`; check `git status` when adding files with "icon" in the name.
- Claude's shell also lacks Homebrew on PATH: use `export PATH="/opt/homebrew/bin:$PATH"` for `gh`.

## Build plan

- **Stage 1 (now):** web app, Worker, Durable Objects. Must be testable end-to-end in two browser tabs locally (`wrangler dev`) before touching the real tablet.

### Stage 1 steps (agreed; each does one thing)

Status: `[ ]` todo · `[~]` in progress · `[x]` signed off and committed.

#### A. Foundations

- [x] 1. Tooling: TypeScript, ESLint, Prettier, markdownlint, Vitest, `npm run check`
- [x] 2. Hello Worker: Worker serves a static page; Worker test
- [x] 3. E2E harness: Playwright drives two fake-camera browsers against `wrangler dev`
- [x] 4. GitHub + CI: repo pushed; Actions runs `npm run check` on push

#### B. Video call (before auth, a dev-only `?role=receiver` switch picks the view)

- [x] 5. Room relay: Durable Object accepts WebSockets and relays messages between receiver and caller
- [x] 6. Receiver joins: idle screen with Join call; tapping turns on the camera (self-view in corner), connects to the room, waits
- [x] 7. Call connects: caller's Join call starts the call; receiver auto-answers; caller video full screen, self-view in corner
- [x] 8. Hang up: caller ends the call cleanly with an explicit `hangup` message; caller → idle, receiver → waiting

#### C. Call rules

- [x] 9. Availability status: caller sees available / unavailable / in call; Join call enabled only while the receiver is waiting
- [x] 10. One caller only: a second caller is refused and sees "in a call"
- [x] 11. Ready-window timeout: no call within the window (restarts after each call) → receiver back to idle, unavailable (DO alarm)
- [x] 12. Call-ended message: after a clean hang-up, the **receiver** goes back to idle showing "The call has ended." with the Join call button (staff rejoin to make it available again); the caller returns to a quiet idle

#### C2. First deploy and TURN (brought forward, agreed)

Deployed **without auth** so the owner could test over the internet with their own devices. (Phase D, done in steps 14–18, now requires sign-in.) Steps keep their original numbers.

- [x] 19. First deploy to workers.dev: `npm run deploy`, with setup instructions (Access setup moves to step 16)
- [x] 22. TURN: Worker issues short-lived Cloudflare TURN credentials (brought forward after the first real test: iOS Safari ↔ Firefox showed self-views but no remote video, i.e. no direct path)

#### D. Groups and auth (all before the real tablet goes live)

Reordered (agreed) so the session cookie exists before the Access login: local dev and E2E have no Access, so E2E mints session cookies directly, and local dev uses the `DEV_LOGIN`-only `/dev-login` page. Step numbers 14–18 were reassigned in this order.

- [x] 13. Group URLs: `/<group>/` routes to that group's own room; unknown group gets a 404; E2E tests each use their own group and run in parallel again
- [x] 14. Members and roles: the directory gains each group's members (email → `receiver` / `caller` / `admin`) and a role lookup
- [x] 15. Sessions and "who am I?": our signed session cookie, `/<group>/api/me` (your role and the group's display name, or 404), and a dev-only `/dev-login` page (only when `DEV_LOGIN=true`) for local sign-in
- [x] 16. Role-based view: the page renders the receiver or caller view from `/api/me` (removes the `?role=` switch)
- [x] 17. Access login: Access-guarded `/login` verifies the Access JWT and issues the session cookie
- [x] 18. Enforcement: every page, API call and WebSocket requires a valid session; the room takes the role from the directory, never the URL; non-members get a 404

#### E. Going live (rest)

- [x] 20. Auto-deploy from `main` after CI passes
- [x] 21. Directory file: keep the directory in a local, gitignored `directory.json`; `npm run directory:push` validates it (same rules as the Worker) and uploads it as the `DIRECTORY` secret, printing the member emails to check against the Access policy (replaces the original "Access allow-list sync")

#### F. Reliability

- [x] 23. Auto-reconnect: WebSockets reconnect with backoff; an unclean disconnect holds the call/caller slot for a grace period instead of ending it
- [x] 24. Call recovery: ICE restart after a network blip mid-call
- [x] 25. Connection status: caller sees "reconnecting…"; also show "Connecting…" until media actually flows and "Couldn't connect" if the peer connection fails (today the call screen appears as soon as the remote track exists, even if no video arrives)

#### H. Polish and trial

- [x] 31. Installable app: manifest; home screen icon; receiver launches full screen
- [x] 32. Screen stays awake during the ready window and calls (Wake Lock)
- [ ] 34. Automatic updates: devices always pick up the latest deploy
- [ ] 35. Real-tablet trial: care home Wi-Fi/device checks; handover notes

### Later stages

- **Stage 2 (only if needed):** thin native Android wrapper (WebView loading the same URL) that pins itself (lock-task) and blocks system gestures, in case stray swipes take the receiver out of calls. Cloudflare side should not need to change.

## Deferred / later

- **Maybe: notifications.** Tell callers when the receiver becomes available ("{displayName} is ready for a call"), so they don't need the app open. Likely Web Push from the room (VAPID, implemented with WebCrypto, since the `web-push` npm package doesn't run on Workers); on iPhone this needs the app added to the home screen. Possibly a backup channel (SMS, ntfy or Telegram) if a push isn't seen. Dropped from the build plan (was phase G, steps 26–30).
- **Maybe:** hidden staff exit on the receiver (e.g. 5 s corner long-press → back to idle). Not sure it's needed; revisit after the real-tablet trial.
- **Maybe: `directory:push` also syncs Access** (considered at step 21; the owner chose to update the Access policy by hand for now). The Access policy would include a Zero Trust email list. The script diffs the directory's emails against the list (`GET /accounts/{id}/gateway/lists/{list}/items`) and applies one `PATCH …/gateway/lists/{list}` with `append` / `remove`. It would use a token scoped to Zero Trust lists, kept in a gitignored `.env` as `ACCESS_SYNC_API_TOKEN` (not `CLOUDFLARE_API_TOKEN`, which wrangler would pick up), plus `CLOUDFLARE_ACCOUNT_ID` and `ACCESS_EMAIL_LIST_ID`. It must never empty the list from a missing or invalid directory.
- **Advanced user management (later):** groups and members in **D1** (replacing the `DIRECTORY` secret behind the `Directory` interface), managed in-app by group admins (a Members screen: add by email and role, change role, remove), with `OWNER_EMAILS` able to create groups and manage any group. On every change the Worker also updates a **Zero Trust email list** that the Access policy includes (Lists API `PATCH /accounts/{id}/gateway/lists/{list_id}` with `append` / `remove`; an API token scoped to Zero Trust lists), so only members can request a PIN. Notes from the research:
  - Zero Trust free plan = **50 seats**. Any Access sign-in takes a seat until the user is removed, or auto-removed after a chosen period of inactivity. Our users only pass through Access at `/login` (about once per device per year), so seats ≈ members; enable inactivity removal (e.g. 3 months), which is harmless because our session cookie doesn't depend on Access.
  - **Don't** use an "Everyone" policy: strangers could use up the seats.
  - **External Evaluation** (Access calls our Worker after the PIN to allow or deny, which could read D1 directly with no sync) is an alternative, but it runs _after_ the PIN, so the policy must let anyone request one. The docs don't say whether denied sign-ins use a seat. Only consider it if Cloudflare confirms they don't.
- Receiver UI details (the owner will revisit).
- Optional scheduled auto-answer without staff opening the app (admin setting, off by default).
- Receiver heartbeat / "last seen" on the caller view.
- Quiet hours.
- Call history for group admins (who called, when, how long).

## Non-code considerations

- Agree with the care provider who can call and when.
- Check care home Wi-Fi for captive portals or blocked WebRTC; a 4G SIM in the tablet is the fallback.

## Preferences

- Keep it minimal and boring: few dependencies, plain TypeScript, no frameworks unless clearly worth it.
- Explain any Cloudflare setup steps (Access policy, TURN key, secrets, API tokens) as clear dashboard / `wrangler` instructions.

## Development rules (agreed)

- Everything in TypeScript (strict).
- Build incrementally: get a working feature end-to-end as early as possible (video first, then auth, permissions, etc.).
- Each build step does one specific thing.
- Clean architecture; concise, legible, maintainable code.
- All code linted and unit tested as we go.
- **A feature is NEVER complete until all tests, type checks and linting pass.**
- Keep this file updated with decisions as we make them. It's the project memory.
- **Step workflow (agreed):** build the step → `npm run check` passes → demo/summary to the owner → **the owner signs it off** → then Claude makes one git commit for that step. Never commit before sign-off. (Exception, agreed: phase D steps 14–18 were committed one by one as each passed `npm run check`, and reviewed together at the end. Phase F is back to stopping for sign-off after each step.) Commit straight to `main` (no branches for now).
- **Version control (agreed):** git, with a commit per signed-off step; a **public** GitHub repo `easycall` (agreed), so never commit personal details, emails, user lists or secrets; GitHub Actions runs `npm run check` on every push. Pushes to `main` auto-deploy once CI passes (step 20).

## Cloudflare setup (done by the owner)

The step-by-step guide lives in the **README ("Setting up on Cloudflare")**; keep it up to date there rather than duplicating it here. Things learned along the way:

- **One-time PIN has to be enabled as an identity provider first** (Zero Trust → Integrations → Identity providers → add One-time PIN), or it isn't offered when creating the Access application.
- **The AUD tag** is under the application's Configure → Additional settings ("Application Audience (AUD) Tag"; 64 hex characters). The dashboard URL holds the app _ID_ (a UUID), which is different.
- The Access application must cover **only `/login`**, not the whole Worker.
- **Auto-deploy (step 20):** a Cloudflare API token from the "Edit Cloudflare Workers" template, plus the account ID, stored as GitHub repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (README step 7).
- Secrets: `SESSION_SECRET`, `ACCESS_TEAM_DOMAIN` (hostname only), `ACCESS_AUD`, `TURN_KEY_ID`, `TURN_KEY_API_TOKEN`, `DIRECTORY`. Never set `DEV_LOGIN` in production. Deploy only with `npm run deploy`.

## Environment notes

- Node is managed by nvm; the project pins **Node 24.14.0** (LTS) via `.nvmrc`.
- Claude's shell doesn't source nvm automatically. Prefix commands with `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use >/dev/null;`.
