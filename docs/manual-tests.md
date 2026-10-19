# Acceptance tests

Manual tests of the whole app on real devices and networks: the parts the automated tests can't
cover. Anyone can run them. Run them in order, because each test starts where the previous one
left off.

In the steps, **[Receiver]**, **[Caller A]** and **[Caller B]** are the names in the directory,
and the **group URL** is `https://<your-app>/<group>/`.

## Before you start

You need:

- [ ] **The app deployed**, with the latest version (GitHub Actions green).
- [ ] **A test group in the directory** with three members: a `receiver` and two `callers`, each
      with a name. Upload it with `npm run directory:push`.
- [ ] **Those three emails allowed by the Access policy** on `/login`, and their inboxes to hand
      (signing in sends a code by email).
- [ ] **Three devices with cameras**, each using a different email:
  - the **receiver device**: ideally an Android tablet with Chrome
  - **Caller A**: a phone, on **mobile data**, not the same Wi-Fi as the receiver
  - **Caller B**: any other phone or computer
- [ ] **The receiver device plugged in**, with battery saver off.

## 1. Sign in as a caller

**Do:** On Caller A, open the app's home page, `https://<your-app>/`, and tap **Sign in**.

**Expect:**

- The home page explains what easyCall is, with a big **Sign in** button.
- You're asked for your email, then for a code sent to it. After entering the code, you're taken
  straight to the group's page.
- It shows "[Receiver] isn't available right now", a greyed-out **Join call** button, and "Signed
  in as [Caller A]".

## 2. Set up the receiver device

**Do:**

1. On the receiver device, open the group URL and sign in with the receiver's email.
2. Install the app: Chrome menu → **Install app** (or **Add to Home screen**).
3. Close Chrome and open the app from its new icon, called "easyCall".

**Expect:**

- After signing in, the screen shows only a large **Join call** button.
- The installed app opens full screen, with no address bar.

## 3. Make the receiver available

**Do:** On the receiver device, tap **Join call**. Allow the camera and microphone if asked.

**Expect:**

- The receiver device shows "Waiting for a call…" with its own camera in the corner.
- Within a few seconds, Caller A shows "[Receiver] is ready for a call", and **Join call** is
  enabled.

## 4. Make a call

**Do:** On Caller A, tap **Join call**. Allow the camera and microphone if asked.

**Expect:**

- Caller A shows "Calling…", then the receiver's video full screen, labelled "[Receiver]", with its
  own camera in the corner and a **Hang up** button.
- The receiver device shows "[Caller A] is calling…", then Caller A's video full screen, labelled
  "[Caller A]". It has nothing to tap.
- Video and sound work both ways within about 10 seconds. "Connecting…" disappears once
  connected.

## 5. A second caller can't join

**Do:** Sign in on Caller B and open the group URL.

**Expect:** Caller B shows "[Receiver] is in a call with [Caller A]", and **Join call** is greyed
out.

## 6. The screen stays on

**Do:** Leave the call running for longer than the receiver device's screen timeout (check it in
its settings; 10 minutes is usually enough).

**Expect:** The receiver device's screen stays on, and the call carries on.

## 7. Recover from network drops

**Do:**

1. On the receiver device, turn Wi-Fi off, wait 10 seconds, and turn it back on.
2. On Caller A, switch from mobile data to Wi-Fi (or the other way round).

**Expect:** Each time, Caller A shows "Reconnecting…", and within about 15 seconds the video and
sound come back by themselves. Nobody has to tap anything.

## 8. Recover when the receiver's app is reopened

**Do:** On the receiver device, close the app (or press Home), open it again within 30 seconds,
and tap **Join call**.

**Expect:** The call comes back by itself within about 15 seconds, without Caller A doing
anything.

## 9. Hang up

**Do:** On Caller A, tap **Hang up**.

**Expect:**

- The receiver device shows "The call has ended." with the **Join call** button, and its camera is
  off.
- Caller A goes back to its starting screen, and shows "[Receiver] isn't available right now".
- Caller B also shows "[Receiver] isn't available right now".

## 10. A caller who disappears

**Do:**

1. On the receiver device, tap **Join call**.
2. On Caller B, tap **Join call** and wait until the call is connected.
3. Close the app or browser on Caller B, without hanging up.

**Expect:** About 30 seconds later, the receiver device shows "The call has ended." with the
**Join call** button.

## 11. Nobody calls

**Do:** On the receiver device, tap **Join call**, and let nobody call for 30 minutes (the ready
window).

**Expect:**

- The receiver device shows "No calls just now." with the **Join call** button, and its camera is
  off.
- Callers show "[Receiver] isn't available right now".
- Afterwards, the receiver device's screen dims and sleeps as normal.

## 12. Someone who isn't in the group

**Do:** On any device, sign in with an email that's allowed by Access but isn't in this group, and
open the group URL.

**Expect:** A "Not found" page. Nothing about the group is shown.

## 13. Updates arrive by themselves (optional)

**Do:** Leave the receiver device on its idle screen, deploy a new version, and wait 10 minutes.

**Expect:** The app reloads itself (the screen may flicker), still on its idle screen. An app
that's in a call when you deploy only reloads after the call ends.

## Results

Record anything that failed or felt wrong:

| Date | Test | What happened | Devices and networks |
| ---- | ---- | ------------- | -------------------- |
|      |      |               |                      |
