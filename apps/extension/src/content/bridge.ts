import { hashElements, imageIds, needsRepair } from "../hash";
import type { SceneRead } from "../protocol";

/**
 * ExcalidrawBridge — the ONLY module that knows how excalidraw.com keeps its data.
 * If Excalidraw changes internally, this (and hook.ts) is all that needs fixing,
 * and the daily canary test (see docs) points here first.
 *
 * Verified against Excalidraw's source and live excalidraw.com (see SPIKE.md):
 *   localStorage["excalidraw"]        JSON array of non-deleted elements
 *   localStorage["excalidraw-state"]  JSON appState
 *   IndexedDB "files-db" (v1) / store "files-store"  image fileId -> BinaryFileData
 */
const KEY_ELEMENTS = "excalidraw";
const KEY_STATE = "excalidraw-state";
const FILES_DB = "files-db";
const FILES_STORE = "files-store";
/** appState fields worth carrying between devices (the rest is per-session UI). */
const KEPT_STATE = ["viewBackgroundColor", "gridSize", "gridStep", "gridModeEnabled"];

const parseJson = <T>(raw: string | null, fallback: T): T => {
  try {
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

function openFilesDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(FILES_DB);
    // Mirror idb-keyval's layout so we never leave Excalidraw a DB without its store.
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(FILES_STORE)) req.result.createObjectStore(FILES_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const reqToPromise = <T>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

async function readFiles(wanted: Set<string>): Promise<Record<string, unknown>> {
  if (wanted.size === 0) return {};
  const db = await openFilesDb();
  try {
    if (!db.objectStoreNames.contains(FILES_STORE)) return {};
    const store = db.transaction(FILES_STORE, "readonly").objectStore(FILES_STORE);
    const out: Record<string, unknown> = {};
    for (const id of wanted) {
      const v = await reqToPromise(store.get(id));
      if (v) out[id] = v;
    }
    return out;
  } finally {
    db.close();
  }
}

async function writeFiles(files: Record<string, unknown>): Promise<void> {
  const ids = Object.keys(files);
  if (ids.length === 0) return;
  const db = await openFilesDb();
  try {
    const tx = db.transaction(FILES_STORE, "readwrite");
    const store = tx.objectStore(FILES_STORE);
    for (const id of ids) store.put(files[id], id);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/** Cheap: elements only, no IndexedDB. Used for change detection. */
export function readHash(): { hash: string; elementCount: number } {
  const elements = parseJson<unknown[]>(localStorage.getItem(KEY_ELEMENTS), []);
  const live = (elements as { isDeleted?: boolean }[]).filter((e) => !e.isDeleted);
  return { hash: hashElements(elements), elementCount: live.length };
}

/** Builds a standard `.excalidraw` document from the current canvas. */
export async function readScene(): Promise<SceneRead> {
  const elements = parseJson<unknown[]>(localStorage.getItem(KEY_ELEMENTS), []);
  const state = parseJson<Record<string, unknown>>(localStorage.getItem(KEY_STATE), {});
  const appState: Record<string, unknown> = {};
  for (const k of KEPT_STATE) if (k in state) appState[k] = state[k];
  const ids = imageIds(elements);
  const files = await readFiles(ids);
  return {
    scene: { type: "excalidraw", version: 2, source: location.origin, elements, appState, files },
    hash: hashElements(elements),
    elementCount: (elements as { isDeleted?: boolean }[]).filter((e) => !e.isDeleted).length,
  };
}

/**
 * Replaces the canvas with `scene`: images go to IndexedDB (shared between
 * isolated and page worlds), then the page-world hook swaps localStorage and
 * nudges Excalidraw's own tab-sync to pick it up (no reload when the tab is visible).
 */
export async function loadScene(scene: { elements?: unknown[]; appState?: Record<string, unknown>; files?: Record<string, unknown> }): Promise<void> {
  await writeFiles(scene.files ?? {});
  const elements = scene.elements ?? [];
  const current = parseJson<Record<string, unknown>>(localStorage.getItem(KEY_STATE), {});
  // Only carry over the few appState fields we own; never let a foreign file inject UI state.
  const incoming: Record<string, unknown> = {};
  for (const k of KEPT_STATE) if (scene.appState && k in scene.appState) incoming[k] = scene.appState[k];
  window.postMessage(
    {
      source: "ecd-content",
      type: "replace",
      elements,
      appState: { ...current, ...incoming },
      // Excalidraw's live tab-sync does NOT repair elements (only a fresh page load does).
      // Files from older/other tools may lack fields, so those take the reload path.
      reload: needsRepair(elements),
    },
    location.origin,
  );
}
