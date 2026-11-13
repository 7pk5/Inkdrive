interface ElementLike {
  id?: string;
  type?: string;
  fileId?: string | null;
  version?: number;
  isDeleted?: boolean;
}

/**
 * True if any element lacks fields a current Excalidraw always writes. Excalidraw's live tab-sync does
 * not repair elements (only a fresh page load does), so such files are loaded through a reload.
 */
export function needsRepair(elements: unknown[]): boolean {
  return (elements as Record<string, unknown>[]).some(
    (e) =>
      !e ||
      typeof e.id !== "string" ||
      typeof e.type !== "string" ||
      typeof e.index !== "string" ||
      typeof e.version !== "number" ||
      typeof e.versionNonce !== "number" ||
      typeof e.seed !== "number",
  );
}

/** Ids of images still used by (non-deleted) elements. */
export function imageIds(elements: unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const e of elements as (ElementLike | null)[]) {
    if (e && e.type === "image" && e.fileId && !e.isDeleted) ids.add(e.fileId);
  }
  return ids;
}

/** Hash of a whole scene's elements (images derived from the elements). */
export const hashElements = (elements: unknown[]): string => sceneHash(elements, [...imageIds(elements)]);

/**
 * Cheap fingerprint of a drawing: element ids + versions (Excalidraw bumps an
 * element's `version` on every change) plus attached image ids. Used to decide
 * "has anything changed since the last sync" without comparing whole scenes.
 */
export function sceneHash(elements: unknown[], fileIds: string[]): string {
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  let live = 0;
  for (const e of elements as (ElementLike | null)[]) {
    if (!e || e.isDeleted) continue;
    live++;
    feed(`${e.id}:${e.version};`);
  }
  for (const f of [...fileIds].sort()) feed(`f:${f};`);
  return `${h.toString(16)}-${live}`;
}
