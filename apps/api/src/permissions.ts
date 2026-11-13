import type { Access } from "@ecd/shared";
import type { Db } from "./db.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatar: string | null;
}

export type Action = "read" | "write" | "manage";

const RANK: Record<Access, number> = { viewer: 1, editor: 2, owner: 3 };
const NEEDS: Record<Action, number> = { read: 1, write: 2, manage: 3 };

export interface Resolved {
  access: Access;
  ownerId: string;
  kind: "file" | "folder";
  /** The item itself is in the trash. */
  trashed: boolean;
  /** An enclosing folder is in the trash, so the item is unreachable until that folder is restored. */
  hidden: boolean;
}

/**
 * THE ONLY place that decides who can touch an item. Every file/folder route goes through
 * `requireFile`, so there is no path that skips this check.
 *
 * Google-Drive-style inheritance: access to a folder applies to everything inside it, so the
 * effective role is the best of: owner of the item, a share on the item OR any enclosing folder
 * (matched on the caller's verified Google email), or a redeemed share link on the item or any
 * enclosing folder that is still enabled.
 *
 * Callers answer 404 (never 403) when this returns null or the action is not allowed, so the
 * existence of items does not leak.
 */
export async function accessFor(db: Db, user: AuthUser, itemId: string): Promise<Resolved | null> {
  const rows = await db.query<{
    owner_id: string | null;
    kind: "file" | "folder" | null;
    trashed: boolean | null;
    hidden: boolean | null;
    share_editor: boolean | null;
    share_count: string | number;
    link_role: string | null;
  }>(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_id, owner_id, kind, deleted_at, 0 AS depth FROM files WHERE id = $1
       UNION ALL
       SELECT f.id, f.parent_id, f.owner_id, f.kind, f.deleted_at, c.depth + 1
         FROM files f JOIN chain c ON f.id = c.parent_id
     )
     SELECT
       (SELECT owner_id FROM chain WHERE depth = 0) AS owner_id,
       (SELECT kind FROM chain WHERE depth = 0) AS kind,
       (SELECT deleted_at IS NOT NULL FROM chain WHERE depth = 0) AS trashed,
       COALESCE((SELECT bool_or(deleted_at IS NOT NULL) FROM chain WHERE depth > 0), false) AS hidden,
       (SELECT bool_or(s.role = 'editor') FROM shares s JOIN chain c ON s.file_id = c.id WHERE s.invited_email = $2) AS share_editor,
       (SELECT count(*) FROM shares s JOIN chain c ON s.file_id = c.id WHERE s.invited_email = $2) AS share_count,
       (SELECT l.role FROM link_shares l
          JOIN link_access a ON a.file_id = l.file_id
          JOIN chain c ON c.id = l.file_id
         WHERE l.enabled AND a.user_id = $3
         ORDER BY (l.role = 'editor') DESC LIMIT 1) AS link_role`,
    [itemId, user.email.toLowerCase(), user.id],
  );
  const r = rows[0];
  if (!r || !r.owner_id || !r.kind) return null;
  let access: Access | null = null;
  if (r.owner_id === user.id) access = "owner";
  else if (r.share_editor || r.link_role === "editor") access = "editor";
  else if (Number(r.share_count) > 0 || r.link_role) access = "viewer";
  if (!access) return null;
  return { access, ownerId: r.owner_id, kind: r.kind, trashed: !!r.trashed, hidden: !!r.hidden };
}

export function can(access: Access, action: Action): boolean {
  return RANK[access] >= NEEDS[action];
}

/** The strongest of several (possibly missing) access levels. */
export function bestAccess(...levels: (Access | string | null | undefined)[]): Access | null {
  let best: Access | null = null;
  for (const l of levels) {
    if (l !== "owner" && l !== "editor" && l !== "viewer") continue;
    if (!best || RANK[l] > RANK[best]) best = l;
  }
  return best;
}
