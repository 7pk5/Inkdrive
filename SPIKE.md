# Phase 0 spike: results

Checked on 2026-11-13 against Excalidraw's source (github.com/excalidraw/excalidraw, `excalidraw-app/`) **and** live
excalidraw.com in Chrome. The extension's own bridge and hook code were bundled and run inside the live page.

| # | Assumption | Result | Evidence |
|---|---|---|---|
| 1 | `localStorage["excalidraw"]` = JSON array of elements | **Confirmed** | `app_constants.ts` `STORAGE_KEYS`; `LocalData.ts` saves `getNonDeletedElements(...)`; live key present |
| 2 | `localStorage["excalidraw-state"]` = JSON appState incl. `viewBackgroundColor`, `gridSize` | **Confirmed** | `appState.ts` marks them `browser: true`; live key present; background colour applied after our load |
| 3 | Images in IndexedDB `files-db` / `files-store`, keyed by fileId | **Confirmed** | `createStore("files-db","files-store")` in `LocalData.ts`; live DB v1 with that store; image written by our bridge rendered on canvas and was read back |
| 4 | Excalidraw persists via `localStorage.setItem` (hook sees edits) | **Confirmed** | `saveDataStateToLocalStorage` calls `localStorage.setItem` (debounced 300 ms, skipped while tab hidden) |
| 5 | Replacing storage + reload restores the drawing | **Replaced by something better** | See below: no reload needed |
| 6 | Loading does not bump element versions (so no spurious first autosave) | **Confirmed** | Loaded elements kept `version` 3/3; our hash before == after; zero "changed" events fired during load |

## The better loading method (found during the spike)

Excalidraw already syncs between browser tabs: on window `focus` it compares `localStorage["version-dataState"]` to its
in-memory timestamp and, if storage is newer, re-imports elements and appState into the *running* scene
(`syncData` in `App.tsx`); a newer `version-files` also loads missing images from IndexedDB.
So to open a cloud file the extension writes images to IndexedDB, writes the two localStorage keys, stamps both
version keys 5 s in the future and fires a `focus` event. Verified live: shapes, image and background colour
appeared without a reload. A synthetic Shift+1 (Excalidraw's zoom-to-fit) then brings the drawing into view
(otherwise it can land off-screen). If the tab is hidden, Excalidraw skips the sync, so we fall back to a reload.

## Not verifiable here

- The extension itself running inside Chrome (loading an unpacked extension needs the Chrome UI). The bridge and hook
  were tested as page scripts; the Chrome-specific parts (side panel, Google sign-in, message passing) are untested.
- Live collaboration rooms and `#json=` share links: we deliberately do nothing there (Excalidraw skips local sync while collaborating).

## Remaining test script (about 10 minutes, with the extension loaded)

1. `DEV_LOGIN=1 API_URL=http://localhost:8787 npm run build:ext`, start the API with `DEV_AUTH=1` (README), load `apps/extension/dist`.
2. Draw shapes, paste an image, **Save current drawing to cloud**.
3. Clear the canvas, open the saved file from the panel: shapes and image come back, view fits.
4. Edit, wait 5 s: button shows Saving then Saved; revision increases by 1.
5. Open the same file as another dev user (share it first), edit in both: the stale one shows the **Conflict** banner.
6. Stop the API, edit: Offline; restart it: saves within a minute.

Then add a Playwright canary running steps 2-4 against live excalidraw.com daily in CI.
