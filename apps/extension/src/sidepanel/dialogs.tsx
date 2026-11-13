import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { FileMeta, Role, SharingInfo } from "@ecd/shared";
import { API_URL } from "../protocol";
import { api, CHEVRON, FOLDER, Icon, LINK, LOCK, msg } from "./common";

// ---------- building blocks ----------
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h2 className="serif">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function NameDialog(p: { title: string; initial: string; cta: string; onSubmit: (name: string) => void | Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(p.initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim().slice(0, 200);
    if (!n) return;
    setBusy(true);
    await p.onSubmit(n);
  };
  return (
    <Modal title={p.title} onClose={p.onClose}>
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <label className="sr" htmlFor="name-input">Name</label>
        <input id="name-input" ref={ref} className="input" value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="btn" onClick={p.onClose}>Cancel</button>
          <button className="btn primary" disabled={busy || !name.trim()}>{p.cta}</button>
        </div>
      </form>
    </Modal>
  );
}

export function ConfirmDialog(p: { title: string; body: string; cta: string; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  return (
    <Modal title={p.title} onClose={p.onClose}>
      <p className="muted" style={{ margin: 0 }}>{p.body}</p>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={p.onClose}>Cancel</button>
        <button className="btn primary" onClick={() => void p.onConfirm()}>{p.cta}</button>
      </div>
    </Modal>
  );
}

/** Says exactly what is and is not encrypted. Keep this in sync with the README security notes. */
export function PrivacyDialog({ onClose }: { onClose: () => void }) {
  const row = (title: string, text: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <b>{title}</b>
      <span className="muted" style={{ fontSize: 13, lineHeight: "18px" }}>{text}</span>
    </div>
  );
  return (
    <Modal title="Your drawings are encrypted" onClose={onClose}>
      {row("In transit", "Everything between this extension and the server travels over HTTPS.")}
      {row("At rest", "Every drawing, including its images and version history, is stored encrypted with AES-256-GCM. A copy of the database or a backup cannot be read without the server’s key.")}
      {row("Sign-in", "You sign in with Google. We never see or store a password, and our login tokens are stored only as hashes.")}
      {row("Who can open a drawing", "Only you and the people you share it with. The server checks this on every request.")}
      <div className="notice" style={{ gap: 4 }}>
        <b>Honest limit</b>
        <span className="muted" style={{ fontSize: 13, lineHeight: "18px" }}>
          This is not end-to-end encryption. The server holds the key so it can show and share your drawings. File names, emails and who-shared-with-whom are stored unencrypted so search and sharing work.
        </span>
      </div>
      <button className="btn primary" onClick={onClose}>Got it</button>
    </Modal>
  );
}

// ---------- version history ----------
export function HistoryDialog({ file, canRestore, onClose, onRestore }: { file: FileMeta; canRestore: boolean; onClose: () => void; onRestore: (rev: number) => Promise<void> }) {
  const [versions, setVersions] = useState<{ revision: number; createdAt: string; by: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<{ versions: { revision: number; createdAt: string; by: string }[] }>("GET", `/v1/files/${file.id}/versions`).then((r) => setVersions(r.status === 200 ? r.body.versions : []));
  }, [file.id]);
  return (
    <Modal title={`History of “${file.name}”`} onClose={onClose}>
      {versions === null && <div className="muted">Loading…</div>}
      <div style={{ display: "flex", flexDirection: "column", maxHeight: 320, overflowY: "auto" }}>
        {versions?.map((v, i) => (
          <div className="share-row" key={v.revision}>
            <span className="grow">
              <b>{i === 0 ? "Current version" : `Version ${v.revision}`}</b>
              <span className="meta" style={{ display: "block" }}>{new Date(v.createdAt).toLocaleString()} · {v.by}</span>
            </span>
            {i > 0 && canRestore && (
              <button className="btn small" disabled={busy} onClick={async () => { setBusy(true); await onRestore(v.revision); onClose(); }}>Restore</button>
            )}
          </div>
        ))}
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 12 }}>The last 20 saves are kept. Restoring makes the old version the newest one; nothing is lost.</p>
      <button className="btn" onClick={onClose}>Close</button>
    </Modal>
  );
}

// ---------- sharing, Google-Drive style ----------
const initials = (s: string) => (s.trim().charAt(0) || "?").toUpperCase();

function Person({ name, email, right, note }: { name?: string; email: string; right: ReactNode; note?: string }) {
  return (
    <div className="share-row">
      <span className="person-avatar" aria-hidden="true">{initials(name || email)}</span>
      <span className="grow" style={{ minWidth: 0 }}>
        <b style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || email}</b>
        <span className="meta" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{note ?? (name ? email : "")}</span>
      </span>
      {right}
    </div>
  );
}

export function ShareDialog({ file, onClose }: { file: FileMeta; onClose: () => void }) {
  const [info, setInfo] = useState<SharingInfo | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const isFolder = file.kind === "folder";

  const load = useCallback(async () => {
    const r = await api<SharingInfo>("GET", `/v1/files/${file.id}/shares`);
    if (r.status === 200) setInfo(r.body);
    else setErr(`Could not load sharing (${r.status})`);
  }, [file.id]);
  useEffect(() => void load(), [load]);

  const guarded = async (fn: () => Promise<{ status: number }>, okStatuses: number[] = [200, 201, 204]) => {
    setErr("");
    try {
      const r = await fn();
      if (!okStatuses.includes(r.status)) setErr(r.status === 400 ? "Enter a valid email that is not your own." : `That did not work (${r.status}).`);
    } catch (e) {
      setErr(msg(e, "That did not work."));
    }
    await load();
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNote("");
    await guarded(async () => {
      const r = await api<{ emailed?: boolean }>("POST", `/v1/files/${file.id}/shares`, { email: email.trim(), role });
      if (r.status === 201) setNote(r.body?.emailed ? "Added. We emailed them an invite." : "Added. Tell them to sign in to Inkdrive with this email.");
      return r;
    });
    setEmail("");
    setBusy(false);
  };
  const change = (id: string, value: string) =>
    guarded(() => (value === "remove" ? api("DELETE", `/v1/files/${file.id}/shares/${id}`) : api("PATCH", `/v1/files/${file.id}/shares/${id}`, { role: value })));
  const setLink = (enabled: boolean, r?: Role) => guarded(() => api("PUT", `/v1/files/${file.id}/link`, { enabled, role: r }));

  const linkUrl = info?.link.token ? `${API_URL}/s/${info.link.token}` : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(linkUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setErr("Could not copy automatically. Select the link below and copy it.");
    }
  };

  return (
    <Modal title={`Share “${file.name}”`} onClose={onClose}>
      <form onSubmit={add} style={{ display: "flex", gap: 8 }}>
        <label className="sr" htmlFor="share-email">Email address</label>
        <input id="share-email" className="input" type="email" required placeholder="Add people by email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="sr" htmlFor="share-role">Role</label>
        <select id="share-role" className="chip" value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button className="btn primary" style={{ minHeight: 40 }} disabled={busy}>Add</button>
      </form>
      {err && <div className="error" role="alert">{err}</div>}
      {note && !err && <div className="meta" role="status">{note}</div>}

      <div>
        <div className="meta" style={{ fontWeight: 600, marginBottom: 4 }}>People with access</div>
        {info && <Person name={info.owner.name} email={info.owner.email} right={<span className="muted">Owner</span>} />}
        {info?.shares.map((s) => (
          <Person
            key={s.id}
            email={s.email}
            right={
              <select className="chip" aria-label={`Access for ${s.email}`} value={s.role} onChange={(e) => void change(s.id, e.target.value)}>
                <option value="editor">Editor</option>
                <option value="viewer">Viewer</option>
                <option value="remove">Remove access</option>
              </select>
            }
          />
        ))}
        {info?.inherited.map((s) => (
          <Person key={s.id} email={s.email} note={`Inherited from the folder “${s.fromName}”`} right={<span className="muted">{s.role === "editor" ? "Editor" : "Viewer"}</span>} />
        ))}
        {info && info.shares.length === 0 && info.inherited.length === 0 && <div className="muted" style={{ fontSize: 13, padding: "4px 0" }}>Only you can open this {isFolder ? "folder" : "drawing"} right now.</div>}
      </div>

      <div style={{ borderTop: "1px solid var(--line)", paddingTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
        <div className="meta" style={{ fontWeight: 600 }}>General access</div>
        <div className="share-row">
          <span className="person-avatar" aria-hidden="true" style={{ background: info?.link.enabled ? "#eaf3ed" : "var(--sand)" }}>
            <Icon d={info?.link.enabled ? LINK : LOCK} size={16} />
          </span>
          <span className="grow">
            <select className="chip" aria-label="General access" value={info?.link.enabled ? "link" : "restricted"} onChange={(e) => void setLink(e.target.value === "link", info?.link.role)}>
              <option value="restricted">Restricted</option>
              <option value="link">Anyone with the link</option>
            </select>
            <span className="meta" style={{ display: "block", marginTop: 4 }}>
              {info?.link.enabled ? "Anyone signed in with Google who has the link can open it." : "Only the people above can open it."}
            </span>
          </span>
          {info?.link.enabled && (
            <select className="chip" aria-label="Link role" value={info.link.role} onChange={(e) => void setLink(true, e.target.value as Role)}>
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
            </select>
          )}
        </div>
        {info?.link.enabled && (
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" readOnly aria-label="Share link" value={linkUrl} onFocus={(e) => e.currentTarget.select()} />
            <button className="btn" style={{ minHeight: 40 }} onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</button>
          </div>
        )}
      </div>

      <p className="muted" style={{ margin: 0, fontSize: 12 }}>
        {isFolder ? "People you add to a folder can open everything inside it. " : ""}
        Invite emails aren’t sent yet: tell people to sign in with the email you added, or send them the link.
      </p>
      <button className="btn primary" onClick={onClose}>Done</button>
    </Modal>
  );
}

// ---------- move to folder ----------
export function MoveDialog({ item, onMove, onClose }: { item: FileMeta; onMove: (parentId: string | null) => Promise<void>; onClose: () => void }) {
  const [at, setAt] = useState<string | null>(null); // folder being browsed (null = top level)
  const [folders, setFolders] = useState<FileMeta[] | null>(null);
  const [trail, setTrail] = useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    setFolders(null);
    const path = at ? `/v1/files?parent=${at}&kind=folder` : "/v1/files?view=mine&kind=folder";
    void api<{ files: FileMeta[] }>("GET", path).then((r) => setFolders(r.status === 200 ? r.body.files.filter((f) => f.id !== item.id && f.ownerId === item.ownerId) : []));
  }, [at, item.id, item.ownerId]);

  const go = (f: FileMeta | null) => {
    setAt(f ? f.id : null);
    setTrail(f ? [...trail, { id: f.id, name: f.name }] : []);
  };
  const back = (i: number) => {
    const next = trail.slice(0, i + 1);
    setTrail(next);
    setAt(next.length ? next[next.length - 1]!.id : null);
  };
  const here = trail.length ? trail[trail.length - 1]!.name : "My files";
  const same = (at ?? null) === (item.parentId ?? null);

  return (
    <Modal title={`Move “${item.name}”`} onClose={onClose}>
      <nav className="crumbs" aria-label="Destination">
        <button className="link" onClick={() => go(null)}>My files</button>
        {trail.map((t, i) => (
          <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <Icon d={CHEVRON} size={12} />
            <button className="link" onClick={() => back(i)}>{t.name}</button>
          </span>
        ))}
      </nav>
      <div style={{ display: "flex", flexDirection: "column", maxHeight: 260, overflowY: "auto", border: "1px solid var(--line)", borderRadius: 12, background: "var(--paper)" }}>
        {folders === null && <div className="muted" style={{ padding: 12 }}>Loading…</div>}
        {folders?.length === 0 && <div className="muted" style={{ padding: 12 }}>No folders here.</div>}
        {folders?.map((f) => (
          <button key={f.id} className="menu-row" onClick={() => go(f)}>
            <Icon d={FOLDER} /> <span className="grow name">{f.name}</span> <Icon d={CHEVRON} size={14} />
          </button>
        ))}
      </div>
      {err && <div className="error" role="alert">{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onClose}>Cancel</button>
        <button
          className="btn primary"
          disabled={busy || same}
          onClick={async () => {
            setBusy(true);
            try {
              await onMove(at);
              onClose();
            } catch (e) {
              setErr(msg(e, "Could not move it here."));
              setBusy(false);
            }
          }}
        >
          Move to “{here}”
        </button>
      </div>
    </Modal>
  );
}
