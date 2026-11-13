import type { FileWithScene, FileMeta } from "@ecd/shared";
import { hashElements } from "../hash";
import { API_URL, type BgRequest, type BgResponse, type ContentRequest, type OpenFile, type SceneRead, type StoredState, type SyncState } from "../protocol";
import { callApi } from "./api";
import { getAuth, signIn, signInDev, signOut } from "./auth";

const EXCALIDRAW = "https://excalidraw.com/*";

// ---------- small helpers ----------
const getState = (): Promise<StoredState> => chrome.storage.local.get(["auth", "open", "status", "autosave", "ignoreHash"]) as Promise<StoredState>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const untitledName = () => `Untitled · ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
const setOpen = (open: OpenFile | null) => chrome.storage.local.set({ open });

const currentUserId = async () => (await getAuth())?.user.id;

/** After a sign-in, drop the "open file" link if it belonged to someone else (or to a wiped server). */
async function dropForeignOpen(userId: string) {
  const { open } = await getState();
  if (open && open.userId !== userId) await setOpen(null);
}

let idleTimer: ReturnType<typeof setTimeout> | undefined;
async function setStatus(state: SyncState) {
  await chrome.storage.local.set({ status: { state, at: Date.now() } });
  clearTimeout(idleTimer);
  if (state === "saved") idleTimer = setTimeout(() => void setStatus("idle"), 3000);
}

async function findTab(preferred?: number): Promise<number> {
  if (preferred !== undefined) return preferred;
  const active = await chrome.tabs.query({ url: EXCALIDRAW, active: true, lastFocusedWindow: true });
  const any = active[0] ?? (await chrome.tabs.query({ url: EXCALIDRAW }))[0];
  if (!any?.id) throw new Error("Open excalidraw.com in this window first");
  return any.id;
}

async function tabCall<T>(tabId: number, msg: ContentRequest): Promise<T> {
  const res = (await chrome.tabs.sendMessage(tabId, msg)) as BgResponse<T> | undefined;
  if (!res?.ok) throw new Error(res && !res.ok ? res.error : "The page did not answer. Reload excalidraw.com.");
  return res.data;
}

// ---------- autosave ----------
let inflight: Promise<void> | null = null;
let again = false;

/**
 * Saves the canvas to the cloud. Single-flight: callers during a save get the same promise
 * (and one more pass runs afterwards), so awaiting it means "everything up to now is saved".
 * Autosave is ON unless the user paused it. With no file open, the first edit on a non-empty
 * canvas creates an "Untitled · <time>" cloud file, so nothing drawn while signed in is lost.
 */
function syncNow(tabId: number): Promise<void> {
  if (inflight) {
    again = true;
    return inflight;
  }
  inflight = runSync(tabId).finally(() => {
    inflight = null;
  });
  return inflight;
}

async function runSync(tabId: number): Promise<void> {
  try {
    do {
      again = false;
      const s = await getState();
      if (!s.auth || s.autosave === false || s.status?.state === "conflict") return;
      const read = await tabCall<SceneRead>(tabId, { type: "scene:read" });

      if (!s.open) {
        if (read.elementCount === 0 || read.hash === s.ignoreHash) return;
        await setStatus("saving");
        const r = await callApi<FileMeta>("POST", "/v1/files", { name: untitledName(), scene: read.scene });
        if (r.status === 201) {
          await setOpen({ id: r.body.id, name: r.body.name, revision: r.body.revision, access: "owner", userId: s.auth.user.id, hash: read.hash });
          await setStatus("saved");
        } else if (r.status === 401) {
          await setStatus("signedout");
          return;
        } else throw new Error(`create failed ${r.status}`);
        continue;
      }

      const open = s.open;
      if (open.access === "viewer" || read.hash === open.hash) return;
      await setStatus("saving");
      const r = await callApi("PUT", `/v1/files/${open.id}`, { scene: read.scene }, { "if-match": String(open.revision) });
      if (r.status === 200) {
        await setOpen({ ...open, revision: r.body.revision, hash: read.hash });
        await setStatus("saved");
      } else if (r.status === 409) {
        await setStatus("conflict");
        return;
      } else if (r.status === 404) {
        // File was deleted or access removed: stop syncing this one, keep the local drawing.
        await chrome.storage.local.set({ open: null, ignoreHash: read.hash });
        await setStatus("idle");
        return;
      } else if (r.status === 401) {
        await setStatus("signedout");
        return;
      } else {
        throw new Error(`save failed ${r.status}`);
      }
    } while (again);
  } catch {
    await setStatus("offline");
  }
}

/** Is there canvas content that is not in the cloud (ignoring view-only files, which never save)? */
async function canvasIsUnsaved(tabId: number): Promise<boolean> {
  const { open, ignoreHash } = await getState();
  const cur = await tabCall<{ hash: string; elementCount: number }>(tabId, { type: "canvas:hash" });
  if (open) return open.access !== "viewer" && cur.hash !== open.hash;
  return cur.elementCount > 0 && cur.hash !== ignoreHash;
}

// Retry when the network was down: the alarm re-reads the canvas, so nothing is queued in memory.
chrome.alarms.create("retry-sync", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "retry-sync") return;
  const { status } = await getState();
  if (status?.state !== "offline") return;
  const tab = (await chrome.tabs.query({ url: EXCALIDRAW }))[0];
  if (tab?.id) await syncNow(tab.id);
});

// ---------- request router ----------
async function waitForContent(tabId: number, ms = 15000): Promise<void> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      await tabCall(tabId, { type: "canvas:hash" });
      return;
    } catch {
      await sleep(400);
    }
  }
  throw new Error("Excalidraw did not finish loading. Try the link again.");
}

async function openFileInTab(tabId: number, id: string): Promise<string> {
  const r = await callApi<FileWithScene>("GET", `/v1/files/${id}`);
  if (r.status !== 200) throw new Error(r.status === 404 ? "File not found" : `Could not open file (${r.status})`);
  const f = r.body;
  await setOpen({ id: f.id, name: f.name, revision: f.revision, access: "owner", userId: await currentUserId(), hash: hashElements(f.scene.elements) });
  await setStatus("idle");
  await tabCall(tabId, { type: "scene:load", scene: f.scene });
  return f.name;
}

async function handle(req: BgRequest, senderTabId?: number, senderUrl?: string): Promise<unknown> {
  switch (req.type) {
    case "auth:signin": {
      const a = await signIn();
      await dropForeignOpen(a.user.id);
      await setStatus("idle");
      return a.user;
    }
    case "auth:devsignin": {
      const a = await signInDev(req.email);
      await dropForeignOpen(a.user.id);
      await setStatus("idle");
      return a.user;
    }
    case "auth:signout":
      await signOut();
      return null;

    case "api": {
      if (!req.path.startsWith("/v1/")) throw new Error("bad path");
      return callApi(req.method, req.path, req.body);
    }

    case "panel:open":
      if (senderTabId !== undefined) await chrome.sidePanel.open({ tabId: senderTabId });
      return null;

    case "scene:changed": {
      const { auth, open, status, autosave, ignoreHash } = await getState();
      if (!auth || autosave === false || status?.state === "conflict" || senderTabId === undefined) return null;
      if (open ? req.hash === open.hash : req.count === 0 || req.hash === ignoreHash) return null;
      void syncNow(senderTabId);
      return null;
    }

    case "settings:autosave": {
      await chrome.storage.local.set({ autosave: req.on });
      if (req.on) {
        const tabId = await findTab().catch(() => undefined);
        if (tabId !== undefined) void syncNow(tabId);
      }
      return null;
    }

    case "canvas:flush": {
      const tabId = await findTab();
      const { auth, autosave } = await getState();
      if (!auth) return null;
      // Excalidraw writes the canvas to storage ~300 ms after the last edit; let that land first.
      await sleep(450);
      if (autosave !== false) {
        await syncNow(tabId);
        await syncNow(tabId); // second pass picks up anything that changed while the first was in flight
      }
      if (await canvasIsUnsaved(tabId)) {
        const { status } = await getState();
        throw new Error(
          status?.state === "conflict"
            ? "Someone else changed this file, so your latest edits could not be saved."
            : "Your latest changes could not be saved to the cloud.",
        );
      }
      return null;
    }

    case "canvas:status": {
      const tabId = await findTab();
      const cur = await tabCall<{ hash: string; elementCount: number }>(tabId, { type: "canvas:hash" });
      const dirty = await canvasIsUnsaved(tabId);
      return { dirty, elementCount: cur.elementCount, hasOpen: !!(await getState()).open };
    }

    case "file:open":
      return openFileInTab(await findTab(), req.id);

    case "file:saveCurrentAsNew": {
      const tabId = await findTab();
      const read = await tabCall<SceneRead>(tabId, { type: "scene:read" });
      const r = await callApi<FileMeta>("POST", "/v1/files", { name: req.name, scene: read.scene });
      if (r.status !== 201) throw new Error(r.status === 413 ? "Drawing is too large or your storage is full" : `Save failed (${r.status})`);
      await setOpen({ id: r.body.id, name: r.body.name, revision: r.body.revision, access: "owner", userId: await currentUserId(), hash: read.hash });
      await setStatus("saved");
      return r.body;
    }

    case "file:new": {
      const tabId = await findTab();
      const scene = { type: "excalidraw" as const, version: 2, source: "https://excalidraw.com", elements: [], appState: {}, files: {} };
      const r = await callApi<FileMeta>("POST", "/v1/files", { name: req.name, scene, parentId: req.parentId ?? null });
      if (r.status !== 201) throw new Error(r.status === 413 ? "Your storage is full" : `Could not create the drawing (${r.status})`);
      await setOpen({ id: r.body.id, name: r.body.name, revision: r.body.revision, access: "owner", userId: await currentUserId(), hash: hashElements([]) });
      await setStatus("idle");
      await tabCall(tabId, { type: "scene:load", scene });
      return r.body;
    }

    case "file:renamed": {
      const { open } = await getState();
      if (open?.id === req.id) await setOpen({ ...open, name: req.name });
      return null;
    }

    case "file:saveCurrentNow": {
      const tabId = await findTab();
      await syncNow(tabId);
      return null;
    }

    case "file:detach": {
      // Remember what is on the canvas so autosave does not instantly create a new file from it.
      const hash = await findTab()
        .then((t) => tabCall<{ hash: string }>(t, { type: "canvas:hash" }))
        .then((c) => c.hash)
        .catch(() => undefined);
      await chrome.storage.local.set({ open: null, ignoreHash: hash });
      await setStatus("idle");
      return null;
    }
  }
}

chrome.runtime.onMessage.addListener((req: BgRequest, sender, sendResponse) => {
  // Only our own extension pages and content scripts may talk to us.
  if (sender.id !== chrome.runtime.id) return;
  handle(req, sender.tab?.id, sender.url).then(
    (data) => sendResponse({ ok: true, data } satisfies BgResponse),
    (e: unknown) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies BgResponse),
  );
  return true;
});

// ---------- side panel + toolbar icon ----------
// We handle the toolbar click ourselves (Chrome's "open on click" is switched off), so the icon works
// from ANY tab: it takes you to Excalidraw (reusing a tab if one is open, else opening one) and shows
// the Inkdrive panel there. On excalidraw.com tabs the panel is enabled; everywhere else it stays off.
const EXCALIDRAW_ORIGIN = "https://excalidraw.com";
const isExcalidraw = (url?: string) => {
  try {
    return !!url && new URL(url).origin === EXCALIDRAW_ORIGIN;
  } catch {
    return false; // chrome://, about:, malformed: not Excalidraw
  }
};

// Runs on every service-worker start; the call is cheap and idempotent, so a stale setting can never stick.
void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
chrome.runtime.onInstalled.addListener(() => void chrome.sidePanel.setOptions({ enabled: false }));

async function syncPanel(tabId: number, url?: string) {
  await chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: isExcalidraw(url) });
}
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url || info.status === "complete") void syncPanel(tabId, tab.url).catch(() => {});
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    await syncPanel(tabId, (await chrome.tabs.get(tabId)).url);
  } catch {
    /* the tab closed before we could look at it */
  }
});

async function showPanel(tabId: number): Promise<void> {
  await chrome.sidePanel.setOptions({ tabId, path: "sidepanel.html", enabled: true });
  await chrome.sidePanel.open({ tabId });
  void chrome.action.setBadgeText({ tabId, text: "" });
}

chrome.action.onClicked.addListener(async (tab) => {
  // Already on Excalidraw: just show the panel. This runs first, while the click is still "fresh",
  // which Chrome requires before it lets an extension open the side panel.
  if (tab.id !== undefined && isExcalidraw(tab.url)) {
    try {
      await showPanel(tab.id);
    } catch (e) {
      console.warn("Inkdrive: could not open the panel", e);
    }
    return;
  }

  // Anywhere else: go to Excalidraw, then show the panel there.
  let target: chrome.tabs.Tab | undefined;
  try {
    const existing = (await chrome.tabs.query({ url: EXCALIDRAW }))[0];
    target = existing?.id !== undefined ? await chrome.tabs.update(existing.id, { active: true }) : await chrome.tabs.create({ url: EXCALIDRAW_ORIGIN, active: true });
    if (target?.windowId !== undefined) await chrome.windows.update(target.windowId, { focused: true });
  } catch (e) {
    console.warn("Inkdrive: could not open Excalidraw", e);
    return;
  }
  if (target?.id === undefined) return;
  try {
    await showPanel(target.id);
  } catch (e) {
    // If Chrome decides the click is too old by now, make the next step obvious instead of failing silently.
    console.warn("Inkdrive: Excalidraw is open; click the icon once more to show the panel", e);
    await syncPanel(target.id, EXCALIDRAW_ORIGIN).catch(() => {});
    void chrome.action.setBadgeBackgroundColor({ tabId: target.id, color: "#b85634" });
    void chrome.action.setBadgeText({ tabId: target.id, text: "•" });
  }
});
