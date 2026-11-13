import { useEffect, useRef, useState, type ReactNode } from "react";
import { BRAND } from "../brand";
import type { StoredState } from "../protocol";
import { api, bg, Icon, LOCK, mb, TAG } from "./common";

const HELP = "M12 17h.01M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2.5-3 4.5M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z";
const SIGN_OUT = "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9";

type Theme = "system" | "light" | "dark";

function SwitchRow({ title, desc, on, onToggle }: { title: string; desc: string; on: boolean; onToggle: () => void }) {
  return (
    <button className="pm-item" role="menuitemcheckbox" aria-checked={on} onClick={onToggle}>
      <span className="grow">
        <b>{title}</b>
        <span className="meta">{desc}</span>
      </span>
      <span className="switch" data-on={on} aria-hidden="true" />
    </button>
  );
}

/**
 * The profile menu: every setting lives here (and nowhere else), plus help and sign out.
 * Add a new setting by adding one row below and one key to StoredState.
 */
export function ProfileMenu({ stored, onWelcome, onPrivacy, onTags }: { stored: StoredState; onWelcome: () => void; onPrivacy: () => void; onTags: () => void }) {
  const [open, setOpen] = useState(false);
  const [usage, setUsage] = useState<{ usedBytes: number; quotaBytes: number; fileCount: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const user = stored.auth!.user;
  const autosaveOn = stored.autosave !== false;
  const hideOn = stored.hideTopRight !== false;
  const theme: Theme = stored.theme ?? "system";

  useEffect(() => {
    if (!open) return;
    void api("GET", "/v1/me").then((r) => r.status === 200 && setUsage(r.body));
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const section = (label: string): ReactNode => <div className="pm-section">{label}</div>;
  const pct = usage ? Math.min(100, Math.max(1, Math.round((usage.usedBytes / usage.quotaBytes) * 100))) : 0;

  return (
    <div ref={ref}>
      <button
        className="avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Profile and settings for ${user.email}`}
        title="Profile and settings"
        onClick={() => setOpen(!open)}
      >
        {user.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" /> : user.name.charAt(0).toUpperCase()}
      </button>

      {open && (
        <div className="profile-menu" role="menu" aria-label="Profile and settings">
          <div className="pm-head">
            <span className="avatar" aria-hidden="true">{user.avatar ? <img src={user.avatar} alt="" referrerPolicy="no-referrer" /> : user.name.charAt(0).toUpperCase()}</span>
            <span className="grow">
              <b className="name" style={{ display: "block" }}>{user.name}</b>
              <span className="meta" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>{user.email}</span>
            </span>
          </div>

          <div style={{ padding: "0 10px 6px" }}>
            <div className="meta" style={{ display: "flex", justifyContent: "space-between" }}>
              <span>Storage</span>
              <span>{usage ? `${mb(usage.usedBytes)} of ${mb(usage.quotaBytes)}` : "…"}</span>
            </div>
            <div className="meter" role="img" aria-label={usage ? `${pct}% of storage used` : "Loading storage"}><div style={{ width: `${pct}%` }} /></div>
          </div>

          {section("Settings")}
          <SwitchRow
            title="Autosave"
            desc="Save to the cloud as you draw, and before you switch files"
            on={autosaveOn}
            onToggle={() => void bg({ type: "settings:autosave", on: !autosaveOn })}
          />
          <SwitchRow
            title="Tidy Excalidraw’s top bar"
            desc="Hide its Sign in and Share buttons"
            on={hideOn}
            onToggle={() => void chrome.storage.local.set({ hideTopRight: !hideOn })}
          />
          <div className="pm-item" style={{ cursor: "default" }}>
            <span className="grow">
              <b>Theme</b>
              <span className="meta">Look of this panel</span>
            </span>
            <span className="seg" role="group" aria-label="Theme">
              {(["system", "light", "dark"] as const).map((t) => (
                <button key={t} aria-pressed={theme === t} onClick={() => void chrome.storage.local.set({ theme: t })}>
                  {t === "system" ? "Auto" : t === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </span>
          </div>

          <button className="pm-item" role="menuitem" onClick={close(onTags)}>
            <Icon d={TAG} />
            <span className="grow"><b>Manage tags</b><span className="meta">Rename, recolour or delete your tags</span></span>
          </button>

          {section("Help")}
          <button className="pm-item" role="menuitem" onClick={close(onWelcome)}>
            <Icon d={HELP} />
            <span className="grow"><b>Show the welcome guide</b><span className="meta">See where everything is</span></span>
          </button>
          <button className="pm-item" role="menuitem" onClick={close(onPrivacy)}>
            <Icon d={LOCK} />
            <span className="grow"><b>Privacy and encryption</b><span className="meta">What is protected, and what is not</span></span>
          </button>

          {section("About")}
          <div className="pm-item" style={{ cursor: "default", minHeight: 40 }}>
            <span className="grow meta">
              {BRAND} {chrome.runtime.getManifest().version}
            </span>
          </div>

          <div style={{ borderTop: "1px solid var(--line)", marginTop: 6, paddingTop: 6 }}>
            <button className="pm-item danger" role="menuitem" onClick={close(() => void bg({ type: "auth:signout" }))}>
              <Icon d={SIGN_OUT} />
              <span className="grow"><b>Sign out</b></span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
