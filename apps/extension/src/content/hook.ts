/**
 * Runs in the PAGE's own JS world at document_start (before Excalidraw boots).
 * Two jobs, nothing else:
 *   1. tell the content script when Excalidraw persists the drawing, and
 *   2. on command, replace the stored drawing.
 *
 * How (2) works — verified against Excalidraw's source and live excalidraw.com
 * (see SPIKE.md): Excalidraw already syncs between browser tabs. On window
 * focus it compares localStorage["version-dataState"] with its in-memory
 * timestamp and, if storage is newer, re-imports elements/appState from
 * localStorage into the running scene (and loads missing images from IndexedDB
 * when "version-files" is newer). So we write the new drawing, stamp both
 * versions slightly in the future, and fire a focus event: no page reload.
 * While that happens Excalidraw's own writes are held off so a pending
 * debounced save of the OLD drawing cannot overwrite ours.
 * If the tab is hidden Excalidraw skips the sync, so we fall back to a reload.
 */
const WATCHED = new Set(["excalidraw", "excalidraw-state"]);
const KEY_ELEMENTS = "excalidraw";
const KEY_STATE = "excalidraw-state";
const KEY_VERSION_DATA = "version-dataState";
const KEY_VERSION_FILES = "version-files";
/** Excalidraw debounces its own save by 300ms; keep writes held well past that. */
const HOLD_MS = 1500;

let held = false;

const originalSetItem = Storage.prototype.setItem;
Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
  if (this === window.localStorage && WATCHED.has(key)) {
    if (held) return;
    originalSetItem.call(this, key, value);
    window.postMessage({ source: "ecd-hook", type: "changed" }, window.location.origin);
    return;
  }
  originalSetItem.call(this, key, value);
};

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window || e.origin !== window.location.origin) return;
  const d = e.data as { source?: string; type?: string; elements?: unknown; appState?: unknown; reload?: boolean } | null;
  if (!d || d.source !== "ecd-content" || d.type !== "replace") return;

  held = true;
  originalSetItem.call(window.localStorage, KEY_ELEMENTS, JSON.stringify(d.elements ?? []));
  originalSetItem.call(window.localStorage, KEY_STATE, JSON.stringify(d.appState ?? {}));

  if (document.hidden || d.reload) {
    window.location.reload(); // fresh load repairs old files; held stays true until the page is gone
    return;
  }
  const future = JSON.stringify(Date.now() + 5000);
  originalSetItem.call(window.localStorage, KEY_VERSION_DATA, future);
  originalSetItem.call(window.localStorage, KEY_VERSION_FILES, future);
  window.dispatchEvent(new Event("focus"));
  // The opened drawing can be far from the current viewport. Excalidraw's own "zoom to
  // fit" shortcut (Shift+1) brings it into view; verified to work as a synthetic event.
  setTimeout(() => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "!", code: "Digit1", shiftKey: true, bubbles: true }));
  }, 400);
  setTimeout(() => {
    held = false;
  }, HOLD_MS);
});
