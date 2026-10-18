# easyCall

## What this is

A very simple video-calling system so family can call a family member in care who can't operate normal video apps (mainstream video apps are too complex). The person being called (the **receiver**) must never need to touch the screen. Built to support several family **groups**, each with their own receiver.

## How it works (agreed model)

1. Care home staff open the app on the receiver's Android tablet (already set up with a simple launcher). The tablet runs **Chrome on Android**, and that's the target browser for the receiver view. The app opens on the **idle** screen.
2. Staff tap **Join call**. That is the "ready" signal and the consent. The receiver's camera turns on (self-view in the corner), the tablet connects to the group's room and the receiver is marked **available** (receiver state: _in call, waiting_).
3. The group's callers get a push notification: "{displayName} is ready for a call."
4. The first caller to press their **Join call** is connected automatically, with no answering on the receiver's side. The caller's video goes full screen and the receiver's self-view stays in the corner (_in call, active_).
5. When the caller hangs up, the receiver goes back to _waiting_ (still available).
6. If nobody calls within the ready window, or staff use the hidden exit, the receiver goes back to **idle**: camera off, disconnected, **unavailable**.

### Screen states (agreed)

- **Receiver:** _idle_ (big "Join call" button) → _in call_, which is either _waiting_ (own camera in the corner, available) or _active_ (caller video full screen + own camera in the corner).
  - Caller hangs up → _waiting_. Ready-window timeout or hidden staff exit → _idle_.
- **Caller:** same layout: _idle_ with a "Join call" button that's **only enabled while the receiver is waiting** → _in call, active_. Callers never wait in the room. Hang up → _idle_.
- A web page can't reliably close itself, so the app never "closes"; _idle_ is the resting state.

## Requirements

- No outgoing calls from the receiver (for now).
- No interaction needed on the tablet during a call. Once joined, the page has nothing to tap.
- Staff tapping **Join call** is the "ready" signal and the consent. The camera is only on, and can only connect, while the receiver is joined.
- **Ready-window timeout:** if nobody calls within ~20–30 min (configurable) of joining or of the last call ending, go back to _idle_.
- **Hidden staff exit:** e.g. long-press a corner for ~5 s to go back to _idle_ early.
- Only one caller connected at a time.
- Users and their roles managed simply; minimal custom auth code (Access does identity).
- Everything updatable remotely; the owner can't easily visit the tablet.
- Recovers by itself from Wi-Fi drops (care home Wi-Fi may be flaky or locked down).
- **Clean vs unclean exit (agreed):** handle them differently.
  - **Clean:** someone deliberately hangs up. The client sends an explicit `hangup` message, and the call ends immediately (caller → idle, receiver → waiting).
  - **Unclean:** the connection is lost (socket closes or drops without a `hangup`, or the media connection fails). Don't end the call straight away: hold the call and the caller's slot for a short grace period while both sides try to reconnect/recover, then end it if they don't come back.
  - Rely on the explicit message, not WebSocket close codes / `wasClean`, which aren't trustworthy across networks.

## Groups, users and roles (agreed)

- **Group:** has a slug, which is its URL: `/<group>/`. **Everyone in the group uses the same URL.** There's no separate tablet URL.
- **Group display name** (agreed): each group has a `displayName` for the person being called (e.g. "Grandma"), used in the UI and notifications ("{displayName} is ready for a call").
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
- Each group gets its own Durable Object room (`idFromName(groupSlug)`): state, calls and push subscriptions are fully separate per group.

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
  - Sends Web Push "ready" notifications (VAPID, WebCrypto; the `web-push` npm package doesn't run on Workers) to the group's subscribed callers.
  - Issues short-lived Cloudflare TURN credentials.
- **Media:** peer-to-peer WebRTC with **Cloudflare Realtime TURN** as fallback. The caller always offers and the receiver always answers. Swap to Realtime SFU later only if multi-party calls are wanted. (Pricing: $0.05/GB egress after 1,000 GB/month free, shared with SFU; expected usage is well inside the free tier.)
- **Web app** (static assets on the Worker, installable PWA). One app, with the view chosen by role:
  - **Caller view:** own camera in the corner during a call (same layout as the receiver). Shows available / not available; Join call button only enabled when the receiver is waiting. Registers for Web Push (on iPhone this requires adding to home screen first).
  - **Receiver view:** full screen. Follows the screen states above: _idle_ → Join call → _waiting_ → auto-accepts the incoming call (gentle chime) → _active_ → back to _waiting_; timeout or staff exit → _idle_.

## Code structure (proposed)

- `src/shared/`: protocol message types + type guards.
- `src/worker/`: routing, auth, directory, TURN, push; `room.ts` is a thin DO shell over a pure `room-state.ts` state machine that returns new state + effects.
- `src/client/`: shared lib (reconnecting socket, peer wrapper) + caller and receiver views.
- Principle: keep logic pure and testable; DO/DOM/WebRTC code are thin adapters.
- **UI approach (agreed by default):** no framework. Plain DOM + TypeScript: each view has a `State` union and a `render(state)` that rebuilds its content with `replaceChildren`, plus small `element` / `video` helpers in `dom.ts`. Plain CSS in `style.css`. Revisit only if the UI grows enough to justify a framework.
- **Current endpoints:** `GET /api/room?role=receiver|caller` (WebSocket upgrade) → the `Room` DO. For now there's one shared room named `dev` (per-group rooms come in step 13), and the role comes from the query string (dev only, replaced by real identity in steps 14–17).
- **Room (step 5):** `src/worker/room.ts` uses the WebSocket Hibernation API (`ctx.acceptWebSocket` with the role as a tag). It relays messages opaquely: receiver → all callers, caller → receiver; it never echoes back or relays caller ↔ caller. Bound as `ROOM` (SQLite-backed DO, migration `v1`). `src/shared/roles.ts` defines `Role` + `isRole`.
- **Protocol (steps 7–8):** `src/shared/protocol.ts` defines `Signal` (`offer` / `answer` / `candidate`, for the peer connection) and `Message` (everything on the room socket: `Signal` | `hangup`), plus `parseMessage` (validates untrusted JSON; unknown fields dropped). The room still relays opaquely; clients ignore anything that doesn't parse.
- **Client call flow (steps 6–7):**
  - `peer.ts`: `createPeer` wraps `RTCPeerConnection` (STUN `stun.cloudflare.com:3478`). The caller always offers and the receiver always answers. Incoming signals are processed strictly in order through a queue (so candidates wait for the offer), and one failed signal doesn't block later ones.
  - `session.ts`: `sessionStarter(role, deps)` turns on the camera, connects to the room and creates the peer, emitting `connected` / `remote` / `ended` events, and returns a `Session` with `hangUp()`. The caller calls as soon as it's connected. **Clean exit (step 8):** `hangUp()` sends `hangup` (only if the socket is open), then tears down; the resulting socket close isn't treated as a lost connection. On receiving `hangup`, the receiver closes the peer, makes a fresh one and goes back to `connected` (waiting); a caller's call ends. A lost connection tears everything down (reconnect comes in step 23). Camera, socket and peer factory are injected for tests.
  - `call-view.ts`: one view for both roles (`mountCallView(root, role, start)`): `idle` → `joining` → `waiting` ("Waiting for a call…" / "Calling…", with self-view) → `active` (remote full screen + muted self-view in the corner). Only the caller gets a Hang up button (while calling and in a call); the receiver has nothing to tap once joined. An `ended` event without a reason returns quietly to idle. Split into separate views only if they genuinely diverge.
  - `signalling.ts`: `RoomSocket` type plus `sendMessage` / `onMessage`. `dom.ts`: `element` and `video` helpers. `test-fakes.ts`: shared fakes (socket, camera, peer).
  - `main.ts` picks the role with the dev-only `?role=receiver|caller` switch (removed in step 15).

## Tooling

- **In place (step 1):** TypeScript 6 (strict + `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESLint 10 + typescript-eslint `strictTypeChecked` + `stylisticTypeChecked` (`eslint-config-prettier` turns off style rules), Prettier (print width 100), markdownlint-cli2 (prettier-compatible style), Vitest 5.
- Scripts: `typecheck`, `lint` (ESLint + markdownlint), `format` / `format:check`, `test` (Vitest), `test:e2e` (Playwright), and **`check`** (all of them, E2E included; this is the definition of done). Run `npm run format` to fix formatting.
- **Build/dev (step 6):** Vite 8 + `@cloudflare/vite-plugin` runs the Worker (in workerd) and the client together. `index.html` (root) → `src/client/main.ts`. `npm run dev` = `vite dev` on port 8787; `npm run build` = `vite build` (client + Worker into `dist/`); `npm run preview` = build + `vite preview`. `wrangler.jsonc` has no `assets.directory`: the plugin fills it in at build time. `worker-configuration.d.ts` is generated by `npm run types` and committed; `typecheck` runs `wrangler types --check` so it can't drift. Rerun `npm run types` after changing `wrangler.jsonc`.
- **Unit tests:** colocated `*.test.ts`, as two Vitest projects. **worker** (`src/worker`, `src/shared`) runs inside workerd via `@cloudflare/vitest-plugin`; call the Worker with `exports.default.fetch()` from `cloudflare:workers`. These **bypass static-asset routing**, so pages are covered by E2E. **client** (`src/client`) runs in happy-dom; note that happy-dom's `MediaStream` lacks `getTracks()`.
- **TypeScript projects:** `tsconfig.base.json` (shared strict options); `tsconfig.worker.json` (`src/worker`, `src/shared`, Workers types, no DOM); `tsconfig.client.json` (`src/client`, `src/shared`, DOM + `vite/client`); `tsconfig.e2e.json` (`e2e/` + root config files, DOM + Node types). The root `tsconfig.json` just references them (for editors/ESLint).
- **E2E (step 3):** Playwright 1.64, Chromium only (matches the tablet), against the **built** app (`npm run build && vite preview`) on port 8788 (started automatically; reused locally if already running, so stop a stale one after changing code). Tests live in `e2e/*.spec.ts`. **Runs with `workers: 1`** because all tests share the single `dev` room (parallel tests talked across each other); remove that in step 13 once each test can use its own group. `e2e/fixtures.ts` provides `receiver` and `caller` pages, each in its own browser context with a fake camera/mic and permissions granted. One-off setup: `npx playwright install chromium`. Chromium is launched with `--allow-loopback-in-peer-connection`: without it, local WebRTC E2E fails on macOS with the firewall in stealth mode, because LAN UDP to the unsigned test browser is dropped (ICE sticks at `checking`).
- **CI (step 4):** `.github/workflows/check.yml` runs on every push and PR: `npm ci`, installs Chromium, runs `npm run check`, and uploads the Playwright report on failure. Node comes from `.nvmrc`.
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

- [~] 9. Availability status: caller sees available / unavailable / in call; Join call enabled only while the receiver is waiting
- [ ] 10. One caller only: a second caller is refused and sees "in a call"
- [ ] 11. Ready-window timeout: no call within the window (restarts after each call) → receiver back to idle, unavailable (DO alarm)
- [ ] 12. Hidden staff exit: 5 s corner long-press → receiver back to idle

#### D. Groups and auth (all before going live)

- [ ] 13. Group URLs: `/<group>/` routes to that group's own room; unknown group gets a 404; E2E tests each use their own group and run in parallel again
- [ ] 14. Directory: users and roles from the env var; "who am I in this group?" API
- [ ] 15. Role-based view: page renders receiver/caller view from role (removes dev switch)
- [ ] 16. Login: Access-guarded `/login` verifies the Access JWT and issues the session cookie
- [ ] 17. Session check: every page, API call and WebSocket requires a valid session; non-members get a 404
- [ ] 18. Role enforcement in the room: only the receiver can go available; only callers can call

#### E. Going live

- [ ] 19. First deploy to workers.dev (with Access setup instructions)
- [ ] 20. Auto-deploy from `main` after CI passes
- [ ] 21. Access allow-list sync from the directory on deploy

#### F. Reliability

- [ ] 22. TURN: Worker issues short-lived Cloudflare TURN credentials
- [ ] 23. Auto-reconnect: WebSockets reconnect with backoff; an unclean disconnect holds the call/caller slot for a grace period instead of ending it
- [ ] 24. Call recovery: ICE restart after a network blip mid-call
- [ ] 25. Connection status: caller sees "reconnecting…"

#### G. Notifications (per group)

- [ ] 26. Subscribe: caller turns notifications on or off; subscription stored
- [ ] 27. Send push: "{displayName} is ready for a call" when the receiver becomes available
- [ ] 28. Open from notification: tapping opens the app
- [ ] 29. Clean up: expired subscriptions removed
- [ ] 30. iPhone guidance: add-to-home-screen prompt

#### H. Polish and trial

- [ ] 31. Installable app: manifest; home screen icon; receiver launches full screen
- [ ] 32. Screen stays awake during the ready window and calls (Wake Lock)
- [ ] 33. Chime when a call connects
- [ ] 34. Automatic updates: devices always pick up the latest deploy
- [ ] 35. Real-tablet trial: care home Wi-Fi/device checks; handover notes

### Later stages

- **Stage 2 (only if needed):** thin native Android wrapper (WebView loading the same URL) that pins itself (lock-task) and blocks system gestures, in case stray swipes take the receiver out of calls. Cloudflare side should not need to change.

## Deferred / later

- Users/roles in D1 with an admin UI (start with env var).
- Receiver UI details (the owner will revisit).
- Optional scheduled auto-answer without staff opening the app (admin setting, off by default).
- Receiver heartbeat / "last seen" on the caller view.
- Quiet hours.
- Backup alert if push isn't seen (SMS via Twilio, or ntfy/Telegram).
- Call history for group admins (who called, when, how long).

## Non-code considerations

- Agree with the care provider who can call and when.
- Check care home Wi-Fi for captive portals or blocked WebRTC; a 4G SIM in the tablet is the fallback.

## Preferences

- Keep it minimal and boring: few dependencies, plain TypeScript, no frameworks unless clearly worth it.
- Explain any Cloudflare setup steps (Access policy, TURN key, VAPID keys, secrets, API tokens) as clear dashboard / `wrangler` instructions.

## Development rules (agreed)

- Everything in TypeScript (strict).
- Build incrementally: get a working feature end-to-end as early as possible (video first, then auth, permissions, etc.).
- Each build step does one specific thing.
- Clean architecture; concise, legible, maintainable code.
- All code linted and unit tested as we go.
- **A feature is NEVER complete until all tests, type checks and linting pass.**
- Keep this file updated with decisions as we make them. It's the project memory.
- **Step workflow (agreed):** build the step → `npm run check` passes → demo/summary to the owner → **the owner signs it off** → then Claude makes one git commit for that step. Never commit before sign-off. Commit straight to `main` (no branches for now).
- **Version control (agreed):** git, with a commit per signed-off step; a **public** GitHub repo `easycall` (agreed), so never commit personal details, emails, user lists or secrets; GitHub Actions runs `npm run check` on every push. Auto-deploy from `main` added once there's a deploy target.

## Environment notes

- Node is managed by nvm; the project pins **Node 24.14.0** (LTS) via `.nvmrc`.
- Claude's shell doesn't source nvm automatically. Prefix commands with `export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use >/dev/null;`.
