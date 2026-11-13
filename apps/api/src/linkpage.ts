import type { FastifyInstance } from "fastify";

/**
 * Landing page for share links (https://<api>/s/<token>). It shows nothing about the item and does not
 * even check the token: opening it is harmless. With the Inkdrive extension installed, a small content
 * script on this page turns the button into "redeem the link and open the drawing".
 */
const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Open in Inkdrive</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #faf9f5; color: #141413; font: 16px/24px Inter, system-ui, -apple-system, sans-serif; }
  main { width: min(440px, calc(100vw - 32px)); background: #fff; border: 1px solid #e3dacc; border-radius: 20px; padding: 32px; box-shadow: 0 12px 32px rgba(20,20,19,.08); }
  .mark { width: 44px; height: 44px; border-radius: 12px; background: #d97757; display: flex; align-items: center; justify-content: center; margin-bottom: 20px; }
  h1 { font: 500 28px/34px Georgia, "Times New Roman", serif; margin: 0 0 8px; }
  p { margin: 0 0 16px; color: #5e5d59; }
  button { font: inherit; font-weight: 600; min-height: 48px; width: 100%; border: 0; border-radius: 12px; background: #b85634; color: #fff; cursor: pointer; }
  button:focus-visible { outline: 3px solid rgba(217,119,87,.5); outline-offset: 2px; }
  #ecd-msg { margin-top: 16px; font-size: 14px; }
  small { display: block; margin-top: 20px; color: #5e5d59; font-size: 13px; line-height: 19px; }
</style>
</head>
<body>
<main>
  <div class="mark" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#faf9f5" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9a4.5 4.5 0 0 1 .5 9H7z"/></svg></div>
  <h1>Someone shared a drawing with you</h1>
  <p>Open it in Excalidraw with the Inkdrive extension. You will sign in with Google so access can be checked.</p>
  <button id="ecd-open" type="button" disabled>Open in Inkdrive</button>
  <div id="ecd-msg" role="status" aria-live="polite">Checking for the Inkdrive extension…</div>
  <small>Don't have Inkdrive yet? Install it in Chrome, then come back to this link.</small>
</main>
<script>
  // The extension's content script enables the button. If nothing happens, the extension is not installed.
  setTimeout(function () {
    var b = document.getElementById("ecd-open");
    if (b && b.disabled) document.getElementById("ecd-msg").textContent = "The Inkdrive extension was not detected in this browser. Install it, then reload this page.";
  }, 1500);
</script>
</body>
</html>`;

export function registerLinkPage(app: FastifyInstance) {
  app.get("/s/:token", async (_req, reply) =>
    reply
      .header("content-type", "text/html; charset=utf-8")
      .header("referrer-policy", "no-referrer")
      .header("cache-control", "no-store")
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'")
      .send(PAGE),
  );
}
