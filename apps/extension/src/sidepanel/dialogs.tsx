import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { FileMeta } from "@ecd/shared";
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
      {row("Who can open a drawing", "Only you. Nothing is shared with anyone, and the server checks this on every request.")}
      <div className="notice" style={{ gap: 4 }}>
        <b>Honest limit</b>
        <span className="muted" style={{ fontSize: 13, lineHeight: "18px" }}>
          This is not end-to-end encryption. The server holds the key so it can show your drawings. File names and your email are stored unencrypted so search works.
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
