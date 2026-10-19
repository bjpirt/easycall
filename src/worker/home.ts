import { escapeHtml } from "./html";

/**
 * The home page (`/`), for anyone who isn't sent straight to their group: what
 * easyCall is and a Sign in button, or, for someone signed in who isn't in a
 * group, who they're signed in as and what to do about it.
 */
export function homePage(signedInAs?: string): string {
  const action = signedInAs
    ? `<p class="note">You're signed in as ${escapeHtml(signedInAs)}, but you haven't been added
    to a family's group yet. Ask whoever set up easyCall for your family to add you.</p>`
    : `<a class="button" href="/login">Sign in</a>
  <p class="note">Only invited family members can sign in.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>easyCall</title>
<meta name="theme-color" content="#111111">
<link rel="icon" href="/icons/icon-192.png">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<style>
  html { background: #111; color: #eee; font: 1.25rem/1.5 system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-content: center; }
  main { max-width: 32rem; padding: 2rem 1.5rem; text-align: center; }
  h1 { margin: 0.5rem 0 1.5rem; font-size: 2.5rem; }
  .button {
    display: inline-block; margin: 1.5rem 0 0.5rem; padding: 1.5rem 3rem; border-radius: 1rem;
    background: #2e7d32; color: white; font-size: 2rem; text-decoration: none;
  }
  .note { color: #aaa; font-size: 1rem; }
</style>
</head>
<body>
<main>
  <img src="/icons/icon-192.png" alt="" width="96" height="96">
  <h1>easyCall</h1>
  <p>A simple way for family to video call someone who finds normal video apps too hard.</p>
  <p>Their tablet answers calls by itself, so they never need to touch the screen. When
    they're ready for a call, family see it here and tap <strong>Join Call</strong>.</p>
  ${action}
</main>
</body>
</html>
`;
}
