import type { FastifyInstance } from "fastify";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Public pages the Chrome Web Store and Google's sign-in consent screen require: a home page and a privacy policy. */
export function registerPublicPages(app: FastifyInstance, contactEmail: string) {
  const contact = contactEmail ? `<a href="mailto:${esc(contactEmail)}">${esc(contactEmail)}</a>` : "the person who runs this server";
  const updated = "November 2026";
  const style = `body{margin:0;background:#faf9f5;color:#141413;font:16px/26px Inter,system-ui,-apple-system,sans-serif}
main{max-width:680px;margin:0 auto;padding:48px 20px 80px}h1{font:500 36px/42px Georgia,"Times New Roman",serif;margin:0 0 8px}
h2{font:500 22px/28px Georgia,"Times New Roman",serif;margin:32px 0 6px}p,li{color:#3d3d3a}a{color:#b85634}.mark{color:#b85634;font-weight:600}small{color:#5e5d59}`;
  const page = (title: string, body: string) =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>${style}</style></head><body><main>${body}</main></body></html>`;
  const send = (html: string) => (_req: unknown, reply: { header: (k: string, v: string) => { type: (t: string) => { send: (b: string) => unknown } } }) =>
    reply.header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'").type("text/html; charset=utf-8").send(html);

  const home = page(
    "Inkdrive",
    `<h1>Ink<span class="mark">drive</span></h1><p>Inkdrive is a Chrome extension that saves your Excalidraw drawings to your own private cloud storage, so you can open them on any computer. Each person's drawings are private to them.</p>
<p>Install the extension, open excalidraw.com, click the Inkdrive button, and continue with Google.</p><p><a href="/privacy">Privacy policy</a></p>`,
  );
  const privacy = page(
    "Inkdrive privacy policy",
    `<h1>Privacy policy</h1><small>Last updated ${updated}</small>
<h2>What we collect</h2><p>When you sign in with Google we receive your name, email address and profile picture. We store the drawings you save (including their images), their names, folders, tags and version history, plus technical logs of sign-ins and requests.</p>
<h2>What we do with it</h2><p>Only to run Inkdrive: sign you in, store your drawings and show them back to you. We do not sell your data, show ads, share it with anyone, or use analytics or tracking.</p>
<h2>Who can see your drawings</h2><p>Only you. Nothing is shared with other users. Drawings are encrypted on our server's storage and in backups. This is not end-to-end encryption: the server must be able to decrypt a drawing to show it to you, so the person who runs the server could technically read stored drawings.</p>
<h2>Security</h2><p>All traffic uses HTTPS. Sign-in tokens are stored only as hashes. Each account can reach only its own items.</p>
<h2>Google user data</h2><p>Inkdrive's use of information received from Google APIs follows the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements. We request only your basic profile (name, email, picture) to identify your account.</p>
<h2>The extension</h2><p>The extension reads the drawing on excalidraw.com only to save it to your account or to load a saved drawing onto the canvas. It keeps your session and settings in the browser's extension storage. It does not run on other sites.</p>
<h2>Retention and deletion</h2><p>We keep your data until you delete it. Deleted items go to the trash and can be restored until you empty it. To have your whole account and data deleted, email ${contact}.</p>
<h2>Children</h2><p>Inkdrive is not directed at children under 13.</p>
<h2>Changes</h2><p>If this policy changes we will update this page and its date.</p>
<h2>Contact</h2><p>${contact}</p>`,
  );
  app.get("/", send(home));
  app.get("/privacy", send(privacy));
}
