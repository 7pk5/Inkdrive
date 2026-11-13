import type { User } from "@ecd/shared";

export const API_URL: string = __API_URL__;

export interface OpenFile {
  id: string;
  name: string;
  revision: number;
  access: "owner" | "editor" | "viewer";
  /** Who opened it, so a different account signing in never inherits this link. */
  userId?: string;
  /** Hash of the scene as last synced with the cloud. */
  hash: string;
}

export type SyncState = "signedout" | "idle" | "saving" | "saved" | "offline" | "conflict" | "readonly";
export interface Status {
  state: SyncState;
  at: number;
}

export interface AuthState {
  accessToken: string;
  accessExp: number; // epoch ms
  refreshToken: string;
  user: User;
}

/** chrome.storage.local keys shared between background, panel and content script. */
export interface StoredState {
  auth?: AuthState | null;
  open?: OpenFile | null;
  status?: Status;
  /** Autosave is ON unless this is explicitly false. */
  autosave?: boolean;
  /** Hide Excalidraw's Sign in and Share buttons (default true). */
  hideTopRight?: boolean;
  /** Panel colour theme: follow the system (default), or force light or dark. */
  theme?: "system" | "light" | "dark";
  /** Set when a share link to a folder was opened: the panel jumps there, then clears it. */
  navTo?: { id: string; at: number } | null;
  /** Canvas hash that must not auto-create a file (set when the user detached or trashed the open file). */
  ignoreHash?: string;
}

/** Everything the background accepts. */
export type BgRequest =
  | { type: "auth:signin" }
  | { type: "auth:devsignin"; email: string }
  | { type: "auth:signout" }
  | { type: "api"; method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; body?: unknown }
  | { type: "file:open"; id: string }
  | { type: "file:saveCurrentAsNew"; name: string }
  | { type: "file:new"; name: string; parentId?: string | null }
  /** Sent only by the content script on the share-link landing page. */
  | { type: "link:open"; token: string }
  | { type: "file:renamed"; id: string; name: string }
  | { type: "file:saveCurrentNow" }
  | { type: "file:detach" }
  | { type: "canvas:status" }
  /** Saves the canvas to the cloud as it is right now; throws if that is not possible. */
  | { type: "canvas:flush" }
  | { type: "settings:autosave"; on: boolean }
  | { type: "panel:open" }
  | { type: "scene:changed"; hash: string; count: number };

export type BgResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string; status?: number; body?: unknown };

/** What the content script accepts from the background. */
export type ContentRequest = { type: "scene:read" } | { type: "scene:load"; scene: unknown } | { type: "canvas:hash" };

export interface SceneRead {
  scene: { type: "excalidraw"; version: 2; source: string; elements: unknown[]; appState: Record<string, unknown>; files: Record<string, unknown> };
  hash: string;
  elementCount: number;
}
