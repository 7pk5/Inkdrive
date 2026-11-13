import type { BgRequest, BgResponse } from "../protocol";
import { BRAND } from "../brand";

// ---------- talking to the background ----------
export async function bg<T = unknown>(req: BgRequest): Promise<T> {
  const res = (await chrome.runtime.sendMessage(req)) as BgResponse<T>;
  if (!res.ok) throw new Error(res.error);
  return res.data;
}
export async function api<T = any>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<{ status: number; body: T }> {
  return bg({ type: "api", method, path, body });
}
export const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback);

export const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
export const mb = (b: number) => (b < 1024 * 1024 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1024 / 1024).toFixed(b < 10 * 1024 * 1024 ? 1 : 0)} MB`);
export const stripExt = (n: string) => n.replace(/\.(excalidraw|json)$/i, "").trim() || "Untitled drawing";
export const safeFileName = (n: string) => n.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "drawing";

export const Icon = ({ d, size = 18 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);
export const CLOUD = "M7 18a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 9a4.5 4.5 0 0 1 .5 9H7z";
export const PLUS = "M12 5v14M5 12h14";
export const UPLOAD = "M12 16V4M7 9l5-5 5 5M5 20h14";
export const DOTS = "M5 12h.01M12 12h.01M19 12h.01";
export const FOLDER = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z";
export const FOLDER_PLUS = "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 10v5M9.5 12.5h5";
export const CHEVRON = "M9 6l6 6-6 6";
export const LINK = "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1";
export const LOCK = "M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6z";
export const CLOSE = "M6 6l12 12M18 6L6 18";
export const TAG = "M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V4h9l8.6 8.6a2 2 0 0 1 0 2.8zM7.5 8.5h.01";

/** File-type icon for an Excalidraw drawing (like Drive shows a Docs icon for a Doc). Folders keep the folder icon. */
export const ExcalidrawFileIcon = ({ size = 28 }: { size?: number }) => (
  <img src="assets/excalidraw-file.png" width={size} height={size} alt="" aria-hidden="true" draggable={false} />
);

/** The Inkdrive mark (same artwork as brand/logo-icon.svg). */
export function Logo({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 128 128" role="img" aria-label={BRAND}>
      <rect width="128" height="128" rx="30" fill="#d97757" />
      <path d="M40 86 C24 86 14 76 14 64 C14 53 23 45 34 45 C35 32 46 24 59 24 C72 24 81 32 84 43 C96 43 106 52 106 64 C106 76 97 86 84 86 Z" fill="none" stroke="#faf9f5" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <g transform="translate(88,100) rotate(-45)">
        <g stroke="#d97757" strokeWidth="9" strokeLinejoin="round" fill="#d97757"><rect x="-9" y="-44" width="18" height="44" rx="3" /><path d="M-9 0 L0 17 L9 0 Z" /></g>
        <rect x="-9" y="-44" width="18" height="44" rx="3" fill="#141413" />
        <rect x="-9" y="-44" width="18" height="11" rx="3" fill="#faf9f5" />
        <path d="M-9 0 L0 17 L9 0 Z" fill="#faf9f5" stroke="#141413" strokeWidth="3.5" strokeLinejoin="round" />
        <path d="M-3.2 9 L0 17 L3.2 9 Z" fill="#141413" />
      </g>
    </svg>
  );
}
