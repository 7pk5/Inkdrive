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
  const cta = installUrl || "https://excalidraw.com";
  const ctaLabel = installUrl ? "Get the Inkdrive extension" : "Open excalidraw.com";
  const font = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif`;
  const serif = `Georgia,'Times New Roman',serif`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#f5f4ee;padding:32px 16px;font-family:${font};color:#29261b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 16px;font-family:${serif};font-size:22px;color:#29261b"><span style="color:#d97757">&#9998;</span>&nbsp;Inkdrive</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e6e2d6;border-radius:16px;padding:32px 28px">
<h1 style="margin:0 0 8px;font-family:${serif};font-weight:400;font-size:26px;line-height:1.25;color:#29261b">${esc(who)} shared a ${i.kind} with you</h1>
<p style="margin:0 0 20px;color:#6b665a;font-size:15px">You can ${can} it.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#faf9f5;border:1px solid #e6e2d6;border-radius:12px"><tr>
<td style="padding:14px 16px;font-size:16px;font-weight:600;color:#29261b">${esc(what)}</td>
<td align="right" style="padding:14px 16px;white-space:nowrap"><span style="background:#f3dfd5;color:#8a3f20;border-radius:999px;padding:3px 10px;font-size:12px;font-weight:600">${i.role === "editor" ? "Editor" : "Viewer"}</span></td></tr></table>
<p style="margin:24px 0 8px;font-weight:600;font-size:14px">How to open it</p>
<ol style="margin:0 0 24px;padding-left:20px;color:#3d3a2f;font-size:15px;line-height:1.6">${steps.map((s) => `<li style="margin-bottom:6px">${esc(s)}</li>`).join("")}</ol>
<a href="${esc(cta)}" style="display:inline-block;background:#d97757;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${ctaLabel}</a>
</td></tr>
<tr><td style="padding:16px 8px 0;color:#8a857a;font-size:12px;line-height:1.5">You received this because someone entered your email address. If you don't know them, ignore this message: nothing happens unless you sign in.</td></tr>
</table></td></tr></table></body></html>`;
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
