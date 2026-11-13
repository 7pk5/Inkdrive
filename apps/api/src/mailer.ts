// Invite emails through Brevo's HTTPS API (Oracle blocks outbound SMTP ports, HTTPS is fine).
// Failure to send NEVER fails a share: the access is already saved, the email is a courtesy.
export interface Invite {
  to: string;
  fromName: string;
  fileName: string;
  kind: "file" | "folder";
  role: "viewer" | "editor";
}

export interface Mailer {
  sendInvite(i: Invite): Promise<void>;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Header-ish text: no newlines, bounded length. */
const clean = (s: string, n = 80) => s.replace(/[\r\n\t]+/g, " ").trim().slice(0, n);

export function renderInvite(i: Invite, installUrl: string) {
  const who = clean(i.fromName) || "Someone";
  const what = clean(i.fileName, 120) || "a drawing";
  const can = i.role === "editor" ? "edit" : "view";
  const subject = `${who} shared "${what}" with you on Inkdrive`;
  const steps = [
    installUrl ? `Install the Inkdrive extension: ${installUrl}` : "Install the Inkdrive Chrome extension (ask the person who shared this with you for it).",
    "Open excalidraw.com and click the Inkdrive button.",
    `Sign in with Google using this address (${i.to}). Access is tied to it.`,
    `Find "${what}" under "Shared with me".`,
  ];
  const text = `${who} gave you permission to ${can} the ${i.kind} "${what}" on Inkdrive.\n\n${steps.map((s, n) => `${n + 1}. ${s}`).join("\n")}\n\nYou received this because someone entered your email address. If you don't know them, ignore this message; nothing happens unless you sign in.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#2a2a28;line-height:1.5">
<h2 style="font-weight:600">${esc(who)} shared a ${i.kind} with you</h2>
<p><b>${esc(what)}</b><br>You can <b>${can}</b> it.</p>
<ol>${steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>
<p style="color:#777;font-size:13px">You received this because someone entered your email address. If you don't know them, ignore this message; nothing happens unless you sign in.</p></div>`;
  return { subject, text, html };
}

export class BrevoMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string,
    private installUrl = "",
    private doFetch: typeof fetch = fetch,
  ) {}
  async sendInvite(i: Invite) {
    const { subject, text, html } = renderInvite(i, this.installUrl);
    const res = await this.doFetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": this.apiKey, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ sender: { name: "Inkdrive", email: this.from }, to: [{ email: i.to }], subject, textContent: text, htmlContent: html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
}

export function makeMailer(cfg: { BREVO_API_KEY: string; MAIL_FROM: string; INSTALL_URL: string }): Mailer | null {
  return cfg.BREVO_API_KEY && cfg.MAIL_FROM ? new BrevoMailer(cfg.BREVO_API_KEY, cfg.MAIL_FROM, cfg.INSTALL_URL) : null;
}
