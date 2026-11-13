import { useCallback, useEffect, useRef, useState } from "react";
import { Scene, type FileMeta, type ListView, type TagWithCount } from "@ecd/shared";
import { BRAND } from "../brand";
import type { StoredState, SyncState } from "../protocol";
import { ConfirmDialog, HistoryDialog, MoveDialog, NameDialog, PrivacyDialog } from "./dialogs";import { ago, api, bg, CHEVRON, CLOUD, DOTS, ExcalidrawFileIcon, FOLDER, FOLDER_PLUS, Icon, LOCK, Logo, msg, PLUS, safeFileName, stripExt, TAG, UPLOAD } from "./common";
import { ProfileMenu } from "./profile";
import { TagChip, TagDot, TagsDialog, TagsManager } from "./tags";
import { WelcomeScreen } from "./welcome";

const TABS: { id: ListView; label: string }[] = [
  { id: "mine", label: "My files" },
  { id: "recent", label: "Recent" },
  { id: "starred", label: "Starred" },
  { id: "trash", label: "Trash" },
];

function useStored(): StoredState | null {
  const [s, setS] = useState<StoredState | null>(null);
  useEffect(() => {
    const load = () => chrome.storage.local.get(["auth", "open", "status", "autosave", "hideTopRight", "theme"]).then((v) => setS(v as StoredState));
    void load();
    const onChange = (_: unknown, area: string) => area === "local" && void load();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return s;
}

// ---------- app shell ----------
export function App() {
  const stored = useStored();
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [tagsOpen, setTagsOpen] = useState(false);
  /** Bumped when tags are managed, so the list reloads. */
  const [tagsRev, setTagsRev] = useState(0);

  // Theme: follow the system unless the profile menu says otherwise.
  const theme = stored?.theme ?? "system";
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  if (!stored) return null;
  return (
    <div className={`app${stored.auth ? "" : " signed-out"}`}>
      <Header stored={stored} onWelcome={() => setWelcomeOpen(true)} onPrivacy={() => setPrivacyOpen(true)} onTags={() => setTagsOpen(true)} />
      {stored.auth ? (
        <Drive stored={stored} onPrivacy={() => setPrivacyOpen(true)} welcomeOpen={welcomeOpen} onWelcomeClose={() => setWelcomeOpen(false)} tagsRev={tagsRev} />
      ) : (
        <SignIn onPrivacy={() => setPrivacyOpen(true)} />
      )}
      {privacyOpen && <PrivacyDialog onClose={() => setPrivacyOpen(false)} />}
      {tagsOpen && <TagsManager onClose={() => { setTagsOpen(false); setTagsRev((n) => n + 1); }} />}
    </div>
  );
}

export function Header({ stored, onWelcome, onPrivacy, onTags }: { stored: StoredState; onWelcome: () => void; onPrivacy: () => void; onTags: () => void }) {
  return (
    <div className="header">
      <Logo size={32} />
      <h1 className="serif">{BRAND}</h1>
      {stored.auth && <ProfileMenu stored={stored} onWelcome={onWelcome} onPrivacy={onPrivacy} onTags={onTags} />}
    </div>
  );
}

const GoogleG = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

/**
 * Sign-in, laid out like Claude's: a large serif headline, one calm card with the primary action, and a big
 * rounded picture. Narrow panel: the picture is a banner on top. Wide panel (about 760px and up): two columns,
 * text on the left, the picture filling the right. The picture is a diagram hand-drawn in Excalidraw (brand/art).
 */
export function SignIn({ onPrivacy }: { onPrivacy: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const go = async () => {
    setBusy(true);
    setErr("");
    try {
      await bg({ type: "auth:signin" });
    } catch (e) {
      setErr(msg(e, "Sign-in failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="signin">
      <div className="signin-main">
        <h2 className="signin-title serif">
          Your drawings,
          <br />
          saved for free.
        </h2>
        <p className="signin-sub serif">Open, share and pick up any Excalidraw drawing on any computer.</p>

        <div className="signin-card">
          <button className="btn-google" disabled={busy} onClick={go}>
            <GoogleG />
            {busy ? "Waiting for Google…" : "Continue with Google"}
          </button>
          {err && <div className="error" role="alert">{err}</div>}
          {__DEV_LOGIN__ && <DevSignIn onError={setErr} />}
          <p className="signin-fine">We only read your name, email and photo. {BRAND} runs on excalidraw.com only and never looks at other tabs.</p>
        </div>

        <button className="link signin-privacy" onClick={onPrivacy}>
          <Icon d={LOCK} size={14} /> How your drawings are protected
        </button>
      </div>

      <figure className="signin-art">
        <img className="art-banner" src="assets/login-banner.svg" alt="" width="950" height="446" draggable={false} />
        <img className="art-wide" src="assets/login-art.svg" alt="" width="950" height="916" draggable={false} />
        <figcaption className="hand">drawn in Excalidraw</figcaption>
      </figure>
    </div>
  );
}

/** Shown only in DEV_LOGIN builds against a localhost API. Never ships to users. */
function DevSignIn({ onError }: { onError: (m: string) => void }) {
  const [email, setEmail] = useState("dev@example.com");
  const go = async (e: React.FormEvent) => {
    e.preventDefault();
    onError("");
    try {
      await bg({ type: "auth:devsignin", email });
    } catch (x) {
      onError(msg(x, "Dev sign-in failed"));
    }
  };
  return (
    <details className="dev-signin">
      <summary>Developer sign-in (local testing only)</summary>
      <form onSubmit={go}>
        <label className="sr" htmlFor="dev-email">Dev email</label>
        <input id="dev-email" className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn small">Sign in as this email</button>
      </form>
    </details>
  );
}

// ---------- the drive ----------
type Dialog =
  | { kind: "name"; title: string; initial: string; cta: string; onSubmit: (n: string) => Promise<void> }
  | { kind: "confirm"; title: string; body: string; cta: string; onConfirm: () => Promise<void> }
  | { kind: "move"; file: FileMeta }
  | { kind: "history"; file: FileMeta }
  | { kind: "tags"; file: FileMeta }
  | null;
type Notice = { tone: "info" | "error"; text: string; action?: { label: string; run: () => void } } | null;
type Crumb = { id: string; name: string };
type FolderInfo = { id: string; name: string; parentId: string | null };

function Drive({ stored, onPrivacy, welcomeOpen, onWelcomeClose, tagsRev }: { stored: StoredState; onPrivacy: () => void; welcomeOpen: boolean; onWelcomeClose: () => void; tagsRev: number }) {
  const [view, setView] = useState<ListView>("mine");
  const [folderId, setFolderId] = useState<string | null>(null);
  const [folderInfo, setFolderInfo] = useState<FolderInfo | null>(null);
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [q, setQ] = useState("");
  const [files, setFiles] = useState<FileMeta[] | null>(null);
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [pending, setPending] = useState<{ run: () => Promise<void> } | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [newMenu, setNewMenu] = useState(false);
  const [dragging, setDragging] = useState(false);
  const seq = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const open = stored.open ?? null;
  const state: SyncState = stored.status?.state ?? "idle";
  const autosaveOn = stored.autosave !== false;

  const load = useCallback(async () => {
    const my = ++seq.current;
    try {
      const qs = q ? `&q=${encodeURIComponent(q)}` : "";
      const listPath = tagFilter ? `/v1/files?tag=${tagFilter}${qs}` : folderId ? `/v1/files?parent=${folderId}${qs}` : `/v1/files?view=${view}${qs}`;
      const r = await api<{ files: FileMeta[]; folder?: FolderInfo }>("GET", listPath);
      if (my !== seq.current) return;
      if (r.status === 404 && folderId) {
        // The folder is gone: fall back to the top level.
        setFolderId(null);
        setNotice({ tone: "info", text: "That folder is no longer available." });
        return;
      }
      if (r.status !== 200) throw new Error(`Could not load files (${r.status})`);
      setFiles(r.body.files);
      setFolderInfo(r.body.folder ?? null);
    } catch (e) {
      if (my === seq.current) setNotice({ tone: "error", text: msg(e, "Could not load files") });
    }
  }, [view, folderId, tagFilter, q]);

  const loadTags = useCallback(async () => {
    const r = await api<{ tags: TagWithCount[] }>("GET", "/v1/tags");
    if (r.status !== 200) return;
    setTags(r.body.tags);
    setTagFilter((cur) => (cur && !r.body.tags.some((t) => t.id === cur) ? null : cur)); // the filtered tag was deleted
  }, []);
  // Tags (and their counts) are reloaded on start, after they are managed, and whenever a save lands.
  useEffect(() => void loadTags(), [loadTags, tagsRev]);
  useEffect(() => {
    if (tagsRev > 0) void load();
  }, [tagsRev, load]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);
  useEffect(() => {
    if (state === "saved") void load();
  }, [state, load]);

  // Breadcrumb for the folder we are in.
  useEffect(() => {
    if (!folderId) {
      setCrumbs([]);
      return;
    }
    let live = true;
    void api<{ path: Crumb[] }>("GET", `/v1/files/${folderId}/path`).then((r) => live && r.status === 200 && setCrumbs(r.body.path));
    return () => {
      live = false;
    };
  }, [folderId]);

  useEffect(() => {
    if (!menuFor && !newMenu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".menu, [data-menu-btn]")) {
        setMenuFor(null);
        setNewMenu(false);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuFor, newMenu]);

  const switchView = (v: ListView) => {
    setView(v);
    setFolderId(null);
    setTagFilter(null);
    setQ("");
  };

  /** Runs an action with the busy flag, shows errors, refreshes the list. */
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice({ tone: "error", text: msg(e, "Something went wrong") });
    } finally {
      setBusy(false);
      await load();
    }
  };

  /**
   * Before replacing the canvas, make sure the current drawing is in the cloud exactly as it is.
   * Autosave on (default): save it silently, then continue; if it cannot be saved, stop and ask.
   * Autosave off: ask what to do with unsaved changes.
   */
  const guard = async (action: () => Promise<void>) => {
    setBusy(true);
    setNotice(null);
    try {
      if (autosaveOn) {
        try {
          await bg({ type: "canvas:flush" });
        } catch (e) {
          setNotice({ tone: "error", text: msg(e, "Could not save the current drawing.") });
          setPending({ run: action });
          return;
        }
        await action();
        return;
      }
      const st = await bg<{ dirty: boolean }>({ type: "canvas:status" });
      if (!st.dirty) await action();
      else setPending({ run: action });
    } catch (e) {
      setNotice({ tone: "error", text: msg(e, "Something went wrong") });
    } finally {
      setBusy(false);
      await load();
    }
  };

  const saveFirstThen = async () => {
    const next = pending;
    if (!next) return;
    if (open) {
      await run(async () => {
        await bg({ type: "file:saveCurrentNow" });
        const st = await bg<{ dirty: boolean }>({ type: "canvas:status" });
        if (st.dirty) throw new Error("Could not save your changes, so nothing was replaced. Check the connection and try again.");
        setPending(null);
        await next.run();
      });
    } else {
      setPending(null);
      setDialog({
        kind: "name",
        title: "Save current drawing first",
        initial: "Untitled drawing",
        cta: "Save and continue",
        onSubmit: async (name) => {
          setDialog(null);
          await run(async () => {
            await bg({ type: "file:saveCurrentAsNew", name });
            await next.run();
          });
        },
      });
    }
  };

  // ----- actions -----
  const openItem = (f: FileMeta) => {
    if (f.trashed) return;
    if (f.kind === "folder") {
      setQ("");
      setTagFilter(null);
      setFolderId(f.id);
      return;
    }
    if (open?.id === f.id) return;
    void guard(async () => void (await bg({ type: "file:open", id: f.id })));
  };
  /** New things go into the folder you are looking at, otherwise into My files. */
  const createParent = folderId;
  const afterCreateAtRoot = () => {
    if (!folderId && view !== "mine") switchView("mine");
  };
  const newDrawing = () =>
    setDialog({
      kind: "name",
      title: "New drawing",
      initial: "Untitled drawing",
      cta: "Create",
      onSubmit: async (name) => {
        setDialog(null);
        afterCreateAtRoot();
        await guard(async () => void (await bg({ type: "file:new", name, parentId: createParent })));
      },
    });
  const newFolder = () =>
    setDialog({
      kind: "name",
      title: "New folder",
      initial: "Untitled folder",
      cta: "Create",
      onSubmit: async (name) => {
        setDialog(null);
        afterCreateAtRoot();
        await run(async () => {
          const r = await api("POST", "/v1/folders", { name, parentId: createParent });
          if (r.status !== 201) throw new Error(`Could not create the folder (${r.status})`);
        });
      },
    });
  const patch = (f: FileMeta, body: object) =>
    run(async () => {
      const r = await api("PATCH", `/v1/files/${f.id}`, body);
      if (r.status >= 400) throw new Error(r.status === 400 ? "It can't be moved there." : `Failed (${r.status})`);
      const b = body as { trashed?: boolean; name?: string };
      if (b.trashed && open?.id === f.id) await bg({ type: "file:detach" });
      if (b.name) await bg({ type: "file:renamed", id: f.id, name: b.name });
    });
  const fetchScene = async (f: FileMeta) => {
    const r = await api("GET", `/v1/files/${f.id}`);
    if (r.status !== 200) throw new Error(`Could not read “${f.name}” (${r.status})`);
    return r.body.scene as unknown;
  };
  const duplicate = (f: FileMeta) =>
    run(async () => {
      const r = await api("POST", "/v1/files", { name: `${f.name} (copy)`.slice(0, 200), scene: await fetchScene(f), parentId: f.parentId });
      if (r.status !== 201) throw new Error(r.status === 413 ? "Your storage is full" : `Could not copy (${r.status})`);
      setNotice({ tone: "info", text: `Made “${r.body.name}”.` });
    });
  const download = (f: FileMeta) =>
    run(async () => {
      const blob = new Blob([JSON.stringify(await fetchScene(f))], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeFileName(f.name)}.excalidraw`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    });
  const restoreVersion = (f: FileMeta) => async (rev: number) => {
    await run(async () => {
      const r = await api("POST", `/v1/files/${f.id}/versions/${rev}/restore`);
      if (r.status !== 200) throw new Error(`Could not restore (${r.status})`);
      if (open?.id === f.id) await bg({ type: "file:open", id: f.id }); // show the restored version
      setNotice({ tone: "info", text: `Restored version ${rev} of “${f.name}”.` });
    });
  };

  const upload = async (list: File[]) => {
    const picked = list.filter((f) => /\.(excalidraw|json)$/i.test(f.name) || f.type === "application/json");
    if (picked.length === 0) {
      setNotice({ tone: "error", text: "Choose .excalidraw files (Excalidraw’s Save to… format)." });
      return;
    }
    setBusy(true);
    setNotice(null);
    const made: FileMeta[] = [];
    const problems: string[] = [];
    for (const f of picked) {
      try {
        if (f.size > 10 * 1024 * 1024) throw new Error("larger than 10 MB");
        const parsed = Scene.safeParse(JSON.parse(await f.text()));
        if (!parsed.success) throw new Error("not an Excalidraw drawing");
        const r = await api("POST", "/v1/files", { name: stripExt(f.name).slice(0, 200), scene: parsed.data, parentId: createParent });
        if (r.status === 413) throw new Error("your storage is full");
        if (r.status !== 201) throw new Error(`server said ${r.status}`);
        made.push(r.body);
      } catch (e) {
        problems.push(`${f.name}: ${e instanceof SyntaxError ? "not valid JSON" : msg(e, "failed")}`);
      }
    }
    setBusy(false);
    afterCreateAtRoot();
    setQ("");
    const text =
      (made.length ? `Uploaded ${made.length === 1 ? `“${made[0]!.name}”` : `${made.length} drawings`}.` : "Nothing was uploaded.") +
      (problems.length ? ` Skipped ${problems.join("; ")}.` : "");
    const only = made.length === 1 ? made[0]! : null;
    setNotice({ tone: problems.length ? "error" : "info", text, action: only ? { label: "Open it", run: () => openItem(only) } : undefined });
    await load();
  };

  // ----- drag and drop -----
  const dragProps = {
    onDragEnter: (e: React.DragEvent) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDragging(true); } },
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault(); },
    onDragLeave: (e: React.DragEvent) => { if (e.currentTarget === e.target) setDragging(false); },
    onDrop: (e: React.DragEvent) => { e.preventDefault(); setDragging(false); void upload(Array.from(e.dataTransfer.files)); },
  };

  /** Brand-new (or emptied) My files: show the start screen, like Excalidraw's own. */
  const isStartScreen = view === "mine" && !q && !folderId && !tagFilter;
  const welcome = (onClose?: () => void) => (
    <WelcomeScreen
      canCreate
      onUpload={() => fileInput.current?.click()}
      onNewDrawing={newDrawing}
      onNewFolder={newFolder}
      onClose={onClose}
    />
  );
  const rootLabel = TABS.find((t) => t.id === view)!.label;
  const emptyText = q
    ? "No drawings match your search."
    : tagFilter ? "Nothing has this tag yet. Tag a drawing from its ⋯ menu."
    : folderId ? "This folder is empty. Add a drawing, a folder, or drop .excalidraw files here."
    : view === "trash" ? "Trash is empty."
    : view === "starred" ? "Star a drawing from its ⋯ menu to find it here."
    : "";

  return (
    <div className="drive" {...dragProps}>
      <div className="body">
        <div className="toolbar">
          <input className="input" type="search" placeholder={folderId ? "Search this folder" : "Search your drawings"} aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="tool" disabled={busy} onClick={() => fileInput.current?.click()} title="Upload .excalidraw files" aria-label="Upload .excalidraw files">
            <Icon d={UPLOAD} size={20} />
          </button>
          <button data-menu-btn className="tool primary" disabled={busy} onClick={() => setNewMenu(!newMenu)} title="New" aria-label="New drawing or folder" aria-haspopup="menu" aria-expanded={newMenu}>
            <Icon d={PLUS} size={22} />
          </button>
          {newMenu && (
            <div className="menu" role="menu" style={{ right: 0, top: 48 }}>
              <button role="menuitem" onClick={() => { setNewMenu(false); newDrawing(); }}><ExcalidrawFileIcon size={18} /> New drawing</button>
              <button role="menuitem" onClick={() => { setNewMenu(false); newFolder(); }}><Icon d={FOLDER_PLUS} size={16} /> New folder</button>
            </div>
          )}
          <input ref={fileInput} type="file" accept=".excalidraw,.json,application/json" multiple hidden onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; void upload(l); }} />
        </div>

        {state === "conflict" && open && (
          <div className="notice warn" role="alert">
            <b>Someone else changed “{open.name}”.</b>
            <span className="muted">Your latest edits were not saved. Keep them as a copy, or load the newer version.</span>
            <div className="actions">
              <button className="btn small primary" onClick={() => run(async () => { await bg({ type: "file:saveCurrentAsNew", name: `${open.name} (copy)` }); })}>Keep mine as copy</button>
              <button className="btn small" onClick={() => run(async () => void (await bg({ type: "file:open", id: open.id })))}>Load theirs</button>
            </div>
          </div>
        )}
        {state === "offline" && <div className="notice warn" role="status"><b>Offline.</b> <span className="muted">Edits stay on this computer and will retry automatically.</span></div>}
        {state === "readonly" && open && <div className="notice" role="status">You have view-only access to “{open.name}”. Edits are not saved.</div>}

        {pending && (
          <div className="notice warn" role="alertdialog" aria-label="Unsaved drawing">
            <b>This canvas has changes that aren’t in the cloud.</b>
            <div className="actions">
              <button className="btn small primary" onClick={() => void saveFirstThen()}>Save it first</button>
              <button className="btn small" onClick={() => { const p = pending; setPending(null); void run(p.run); }}>Continue anyway</button>
              <button className="btn small" onClick={() => setPending(null)}>Cancel</button>
            </div>
          </div>
        )}
        {notice && (
          <div className={`notice${notice.tone === "error" ? " warn" : ""}`} role={notice.tone === "error" ? "alert" : "status"}>
            <span>{notice.text}</span>
            <div className="actions">
              {notice.action && <button className="btn small primary" onClick={notice.action.run}>{notice.action.label}</button>}
              <button className="btn small" onClick={() => setNotice(null)}>Dismiss</button>
            </div>
          </div>
        )}

        <div className="tabs" role="tablist" aria-label="File views">
          {TABS.map((t) => (
            <button key={t.id} role="tab" className="tab" aria-selected={view === t.id && !folderId && !tagFilter} onClick={() => switchView(t.id)}>{t.label}</button>
          ))}
        </div>

        {tags.length > 0 && (
          <div className="tagbar" role="group" aria-label="Filter by tag">
            {tags.map((t) => (
              <button key={t.id} className="tagfilter" aria-pressed={tagFilter === t.id} onClick={() => { setFolderId(null); setQ(""); setTagFilter(tagFilter === t.id ? null : t.id); }}>
                <TagDot color={t.color} /> {t.name} <span className="n">{t.count}</span>
              </button>
            ))}
          </div>
        )}

        {folderId && (
          <nav className="crumbs" aria-label="Folder path">
            <button className="link" onClick={() => setFolderId(null)}>{rootLabel}</button>
            {crumbs.map((c, i) => (
              <span key={c.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <Icon d={CHEVRON} size={12} />
                {i === crumbs.length - 1 ? <b aria-current="page">{c.name}</b> : <button className="link" onClick={() => setFolderId(c.id)}>{c.name}</button>}
              </span>
            ))}
          </nav>
        )}
      </div>

      <div className="list" role="list">
        {files === null && <div className="muted" style={{ padding: 16 }}>Loading…</div>}
        {files?.length === 0 && (isStartScreen ? welcome() : <div className="muted" style={{ padding: 16 }}>{emptyText}</div>)}
        {welcomeOpen && !isStartScreen && <div className="welcome-cover">{welcome(onWelcomeClose)}</div>}
        {files?.map((f, index) => {
          const isFolder = f.kind === "folder";
          return (
            <div key={f.id} style={{ position: "relative" }} role="listitem">
              <div className={`row${open?.id === f.id ? " current" : ""}`}>
                <button className="row-main" disabled={busy || f.trashed} onClick={() => openItem(f)} aria-label={`${isFolder ? "Open folder" : "Open"} ${f.name}`}>
                  <span className="thumb">{isFolder ? <Icon d={FOLDER} /> : <ExcalidrawFileIcon size={28} />}</span>
                  <span className="grow">
                    <span className="name" style={{ display: "block" }}>{f.name}</span>
                    <span className="meta" style={{ display: "block" }}>
                      {open?.id === f.id ? "Open now · " : ""}
                      {isFolder ? "Folder · " : ""}
                      {ago(f.updatedAt)}{f.starred ? " · ★" : ""}
                    </span>
                  </span>
                  {/* tags sit to the right of the name and details, not under them */}
                  {f.tags.length > 0 && (
                    <span className="row-tags" title={f.tags.map((t) => t.name).join(", ")}>
                      <TagChip tag={f.tags[0]!} />
                      {f.tags.length > 1 && <span className="tag-more">+{f.tags.length - 1} more</span>}
                    </span>
                  )}
                  {open?.id === f.id && <span className="dot" aria-hidden="true" />}
                  {isFolder && !f.trashed && <Icon d={CHEVRON} size={14} />}
                </button>
                <button data-menu-btn className="icon-btn" aria-label={`More actions for ${f.name}`} aria-haspopup="menu" aria-expanded={menuFor === f.id} onClick={() => setMenuFor(menuFor === f.id ? null : f.id)}>
                  <Icon d={DOTS} />
                </button>
              </div>
              {menuFor === f.id && (
                <div className="menu" role="menu">
                  {f.trashed ? (
                    <>
                      <button role="menuitem" onClick={() => { setMenuFor(null); void patch(f, { trashed: false }); }}>Restore</button>
                      <button role="menuitem" className="danger" onClick={() => { setMenuFor(null); setDialog({ kind: "confirm", title: `Delete “${f.name}” forever?`, body: isFolder ? "Everything inside it is deleted too. This cannot be undone." : "This cannot be undone.", cta: "Delete forever", onConfirm: async () => { setDialog(null); await run(async () => void (await api("DELETE", `/v1/files/${f.id}?permanent=1`))); } }); }}>Delete forever</button>
                    </>
                  ) : (
                    <>
                      <button role="menuitem" onClick={() => { setMenuFor(null); setDialog({ kind: "name", title: "Rename", initial: f.name, cta: "Rename", onSubmit: async (n) => { setDialog(null); await patch(f, { name: n }); } }); }}>Rename</button>
                      <button role="menuitem" onClick={() => { setMenuFor(null); setDialog({ kind: "tags", file: f }); }}><Icon d={TAG} size={16} /> Tags…</button>
                      {!isFolder && <button role="menuitem" onClick={() => { setMenuFor(null); void duplicate(f); }}>Make a copy</button>}
                      {!isFolder && <button role="menuitem" onClick={() => { setMenuFor(null); void download(f); }}>Download .excalidraw</button>}
                      {!isFolder && <button role="menuitem" onClick={() => { setMenuFor(null); setDialog({ kind: "history", file: f }); }}>Version history</button>}
                      <button role="menuitem" onClick={() => { setMenuFor(null); setDialog({ kind: "move", file: f }); }}>Move to…</button>
                      <button role="menuitem" onClick={() => { setMenuFor(null); void patch(f, { starred: !f.starred }); }}>{f.starred ? "Remove star" : "Add star"}</button>
                      <button role="menuitem" className="danger" onClick={() => { setMenuFor(null); void patch(f, { trashed: true }); }}>Move to trash</button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="footer">
        <button className="chip-secure" onClick={onPrivacy} aria-label="Encrypted. See how your drawings are protected">
          <Icon d={LOCK} size={14} /> Encrypted
        </button>
        {/* Autosave is changed in the profile menu; this is just the status. */}
        <span style={{ textAlign: "right", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
          <span aria-live="polite">{state === "saving" ? "Saving… " : state === "saved" ? "Saved · " : ""}</span>
          {!autosaveOn ? "Autosave is off" : open ? `Autosaving “${open.name}”` : "Autosave on, saves when you draw"}
        </span>
      </div>

      {dragging && <div className="drop" aria-hidden="true"><div><Icon d={UPLOAD} size={28} /><div className="serif" style={{ fontSize: 22 }}>Drop .excalidraw files to upload</div></div></div>}

      {dialog?.kind === "name" && <NameDialog title={dialog.title} initial={dialog.initial} cta={dialog.cta} onSubmit={dialog.onSubmit} onClose={() => setDialog(null)} />}
      {dialog?.kind === "confirm" && <ConfirmDialog title={dialog.title} body={dialog.body} cta={dialog.cta} onConfirm={dialog.onConfirm} onClose={() => setDialog(null)} />}
      {dialog?.kind === "move" && (
        <MoveDialog
          item={dialog.file}
          onClose={() => setDialog(null)}
          onMove={async (parentId) => {
            const r = await api("PATCH", `/v1/files/${dialog.file.id}`, { parentId });
            if (r.status !== 200) throw new Error(r.status === 400 ? "It can’t be moved there (a folder can’t go inside itself)." : `Move failed (${r.status})`);
            setNotice({ tone: "info", text: `Moved “${dialog.file.name}”.` });
            await load();
          }}
        />
      )}
      {dialog?.kind === "tags" && <TagsDialog item={dialog.file} onClose={() => setDialog(null)} onSaved={() => { void loadTags(); void load(); }} />}
      {dialog?.kind === "history" && <HistoryDialog file={dialog.file} canRestore={true} onClose={() => setDialog(null)} onRestore={restoreVersion(dialog.file)} />}
    </div>
  );
}
