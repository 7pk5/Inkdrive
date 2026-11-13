import { BRAND } from "../brand";
import type { StoredState, SyncState } from "../protocol";

const LABEL: Record<SyncState, string> = {
  signedout: BRAND,
  idle: BRAND,
  saving: "Saving…",
  saved: "Saved",
  offline: "Offline",
  conflict: "Conflict",
  readonly: "View only",
};

const CSS = `
:host { all: initial; display: flex; align-items: center; }
button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px 0 10px;
  border: 1px solid #d9d5c7; border-radius: 18px; background: #faf9f5; color: #141413; cursor: pointer; white-space: nowrap;
  font: 600 14px/1 Inter, system-ui, -apple-system, sans-serif; box-shadow: 0 1px 4px rgba(20,20,19,.12); }
button:hover { background: #fff; }
button:focus-visible { outline: 3px solid rgba(217,119,87,.5); outline-offset: 1px; }
.avatar { width: 22px; height: 22px; border-radius: 50%; background: #d97757; color: #141413; font-size: 12px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.avatar img { width: 100%; height: 100%; object-fit: cover; }
svg { display: block; }
.spin { animation: spin 1s linear infinite; transform-origin: center; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
/* Narrow windows: keep just the icon so the top bar never gets crowded. */
@media (max-width: 1000px) { .label { display: none; } button { padding: 0 7px; } }
`;

const CLOUD = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#b85634" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9a4.5 4.5 0 0 1 .5 9H7z"/></svg>`;
const SPIN = `<svg class="spin" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#b85634" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 4a8 8 0 1 0 8 8"/></svg>`;
const CHECK = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2f6f4a" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`;
const DOT = `<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5" fill="#b85634"/></svg>`;

/**
 * Excalidraw's top-right row (verified on live excalidraw.com): a flex container
 * `.layer-ui__wrapper__top-right` holding [.excalidraw-ui-top-right (Sign in + Share)] and the
 * Library button. We sit in that same row, right before the Library button, so we are part of the
 * layout (never floating over anything) and move with it when the window narrows or a sidebar opens.
 */
const LIBRARY_BUTTON = "button.sidebar-trigger__label-element";

export interface ButtonUi {
  render: (s: StoredState) => void;
  destroy: () => void;
}

export function mountButton(onClick: () => void): ButtonUi {
  const host = document.createElement("div");
  host.id = "ecd-button-host";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = CSS;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.addEventListener("click", onClick);
  root.append(style, btn);

  /** Keeps the host next to the Library button; Excalidraw (React) re-creates that row often. */
  const place = () => {
    const lib = document.querySelector<HTMLElement>(LIBRARY_BUTTON);
    const parent = lib?.parentElement;
    if (!lib || !parent) {
      // Layout without a Library button (very narrow windows): step aside. The toolbar icon still opens the panel.
      host.remove();
      return;
    }
    if (host.parentElement !== parent || host.nextElementSibling !== lib) parent.insertBefore(host, lib);
  };
  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(place);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  place();

  const render = (s: StoredState) => {
    const state: SyncState = s.status?.state ?? (s.auth ? "idle" : "signedout");
    const user = s.auth?.user;
    let icon = CLOUD;
    if (state === "saving") icon = SPIN;
    else if (state === "saved") icon = CHECK;
    else if (state === "offline" || state === "conflict") icon = DOT;
    else if (user) icon = `<span class="avatar">${escapeHtml(user.name.charAt(0).toUpperCase())}</span>`;
    const label = LABEL[state];
    btn.innerHTML = `${icon}<span class="label">${label}</span>`;
    btn.setAttribute("aria-label", `${BRAND}: ${label}. Open files panel`);
    btn.title = `${BRAND}: ${label}`;
    if (user?.avatar && icon.startsWith("<span")) {
      const img = document.createElement("img");
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      // Only replace the initial once the photo actually loads (page CSP may block it).
      img.onload = () => btn.querySelector(".avatar")?.replaceChildren(img);
      img.src = user.avatar;
    }
  };
  render({});
  return {
    render,
    destroy: () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      host.remove();
    },
  };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
