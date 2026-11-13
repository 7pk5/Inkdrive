import type { BgRequest, BgResponse, ContentRequest, StoredState } from "../protocol";
import { loadScene, readHash, readScene } from "./bridge";
import { mountButton } from "./button";

let timer: ReturnType<typeof setTimeout> | undefined;
let retired = false;

/**
 * When the extension is reloaded or updated, tabs that were already open keep running this
 * (now orphaned) script, and every chrome.* call throws "Extension context invalidated".
 * Detect that, remove our button and go quiet; reloading the tab brings the new version in.
 */
const alive = () => {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
};
function retire() {
  if (retired) return;
  retired = true;
  clearTimeout(timer);
  ui.destroy();
  applyHide(false); // give Excalidraw's own buttons back when we are gone
}

/**
 * Excalidraw's "Sign in" (Excalidraw+ promo) and "Share" (live collaboration) buttons crowd the top
 * bar, so we hide them by default; the Library button stays. Plain CSS: reversible, no DOM removal.
 */
const HIDE_ID = "ecd-hide-style";
const HIDE_CSS = `.layer-ui__wrapper__top-right .plus-banner, .layer-ui__wrapper__top-right .collab-button { display: none !important; }`;
function applyHide(on: boolean) {
  const el = document.getElementById(HIDE_ID);
  if (on && !el) {
    const s = document.createElement("style");
    s.id = HIDE_ID;
    s.textContent = HIDE_CSS;
    document.head.append(s);
  } else if (!on && el) el.remove();
}

async function send<T = unknown>(req: BgRequest): Promise<BgResponse<T>> {
  if (retired || !alive()) {
    retire();
    return { ok: false, error: "The extension was reloaded. Reload this page." };
  }
  try {
    return (await chrome.runtime.sendMessage(req)) as BgResponse<T>;
  } catch {
    retire();
    return { ok: false, error: "The extension was reloaded. Reload this page." };
  }
}

// ---- the button ----
const ui = mountButton(() => void send({ type: "panel:open" }));
const refresh = () => {
  if (retired || !alive()) return retire();
  chrome.storage.local.get(["auth", "status", "hideTopRight"]).then((v) => {
    const s = v as StoredState;
    applyHide(s.hideTopRight !== false);
    ui.render(s);
  }, retire);
};
refresh();
chrome.storage.onChanged.addListener((_c, area) => area === "local" && refresh());

// ---- change detection: tell the background (debounced) that the drawing changed ----
const DEBOUNCE_MS = 3000;
const notifyChanged = () => {
  if (retired) return;
  const { hash, elementCount } = readHash();
  void send({ type: "scene:changed", hash, count: elementCount });
};
window.addEventListener("message", (e: MessageEvent) => {
  if (retired || e.source !== window || e.origin !== location.origin) return;
  const d = e.data as { source?: string; type?: string } | null;
  if (d?.source !== "ecd-hook" || d.type !== "changed") return;
  clearTimeout(timer);
  timer = setTimeout(notifyChanged, DEBOUNCE_MS);
});
// Switching tabs, minimising or closing the tab: don't wait for the debounce, save now.
// (Excalidraw flushes its own storage write on this event too; the short delay lets it land.)
document.addEventListener("visibilitychange", () => {
  if (retired || document.visibilityState !== "hidden") return;
  clearTimeout(timer);
  setTimeout(notifyChanged, 350);
});

// ---- requests from the background ----
chrome.runtime.onMessage.addListener((msg: ContentRequest, sender, sendResponse) => {
  if (retired || !alive() || sender.id !== chrome.runtime.id) return;
  switch (msg.type) {
    case "scene:read":
      readScene().then((data) => sendResponse({ ok: true, data }), (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    case "canvas:hash":
      sendResponse({ ok: true, data: readHash() });
      return;
    case "scene:load":
      // Answer first: if the tab is hidden the hook falls back to a reload, which kills this script.
      sendResponse({ ok: true, data: null });
      setTimeout(() => void loadScene(msg.scene as Parameters<typeof loadScene>[0]), 50);
      return;
  }
});
