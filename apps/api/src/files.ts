import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  AddShareBody,
  CreateFileBody,
  CreateFolderBody,
  CreateTagBody,
  ListView,
  MAX_SCENE_BYTES,
  MAX_TAGS_PER_USER,
  PatchFileBody,
  SaveFileBody,
  SetLinkBody,
  SetTagsBody,
  UpdateShareBody,
  UpdateTagBody,
  type Access,
  type FileMeta,
  type Scene,
  type SharingInfo,
  type Tag,
} from "@ecd/shared";
import type { Config } from "./config.js";
import type { DataCrypto } from "./crypto.js";
import type { Db } from "./db.js";
import { HttpError, IdParams, parse } from "./http.js";
import { accessFor, bestAccess, can, type Action, type AuthUser } from "./permissions.js";

interface FileRow {
  id: string;
  kind: "file" | "folder";
  name: string;
  owner_id: string;
  owner_name: string;
  parent_id: string | null;
  revision: number;
  size: number;
  starred: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  share_role: string | null;
  link_role: string | null;
  shared: boolean;
}

/** `inherited` = the caller's access to the enclosing folder, which flows down to this item. */
const toMeta = (r: FileRow, u: AuthUser, inherited?: Access | null): FileMeta => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  parentId: r.parent_id,
  revision: r.revision,
  size: r.size,
  starred: r.starred,
  access: r.owner_id === u.id ? "owner" : (bestAccess(r.share_role, r.link_role, inherited) ?? "viewer"),
  shared: r.shared,
  tags: [], // filled in per caller by withTags()
  trashed: r.deleted_at !== null,
  createdAt: new Date(r.created_at).toISOString(),
  updatedAt: new Date(r.updated_at).toISOString(),
});

const FILE_SELECT = `
  SELECT f.id, f.kind, f.name, f.owner_id, u.name AS owner_name, f.parent_id, f.revision, f.size, f.starred,
         f.deleted_at, f.created_at, f.updated_at,
         s.role AS share_role,
         (SELECT l.role FROM link_shares l JOIN link_access a ON a.file_id = l.file_id
           WHERE l.file_id = f.id AND l.enabled AND a.user_id = $1) AS link_role,
         (EXISTS (SELECT 1 FROM shares x WHERE x.file_id = f.id)
          OR EXISTS (SELECT 1 FROM link_shares y WHERE y.file_id = f.id AND y.enabled)) AS shared
    FROM files f
    JOIN users u ON u.id = f.owner_id
    LEFT JOIN shares s ON s.file_id = f.id AND s.invited_email = $2`;

/** Excludes items that sit inside a trashed folder (they come back when the folder is restored). */
const NOT_UNDER_TRASH = `AND NOT EXISTS (
  WITH RECURSIVE up AS (
    SELECT parent_id AS pid FROM files WHERE id = f.id
    UNION ALL
    SELECT g.parent_id FROM files g JOIN up ON g.id = up.pid
  )
  SELECT 1 FROM up JOIN files p ON p.id = up.pid WHERE p.deleted_at IS NOT NULL)`;

/** Everything the caller can reach through a direct share or a redeemed link, plus all descendants. */
const SHARED_TREE = `WITH RECURSIVE roots AS (
    SELECT file_id AS id FROM shares WHERE invited_email = $2
    UNION
    SELECT a.file_id FROM link_access a JOIN link_shares l ON l.file_id = a.file_id WHERE a.user_id = $1 AND l.enabled
  ), tree AS (
    SELECT id FROM roots
    UNION
    SELECT f2.id FROM files f2 JOIN tree t ON f2.parent_id = t.id
  )`;

const encodeScene = (scene: Scene): { raw: number; gz: Buffer } => {
  const json = JSON.stringify(scene);
  const raw = Buffer.byteLength(json);
  if (raw > MAX_SCENE_BYTES) throw new HttpError(413, "scene_too_large", { maxBytes: MAX_SCENE_BYTES });
  return { raw, gz: gzipSync(json) };
};

export const MAX_FOLDER_DEPTH = 30;
export const MAX_ITEMS_PER_USER = 5000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export interface FileDeps {
  db: Db;
  cfg: Config;
  crypt: DataCrypto;
}

export function registerFileRoutes(api: FastifyInstance, { db, cfg, crypt }: FileDeps) {
  /** Each stored blob is bound to its file and revision, so it cannot be moved to another row. */
  const aadFor = (fileId: string, revision: number) => `${fileId}:${revision}`;
  const sealScene = (gz: Buffer, fileId: string, revision: number) => crypt.seal(gz, aadFor(fileId, revision));
  const decodeScene = (blob: Uint8Array, fileId: string, revision: number): Scene =>
    JSON.parse(gunzipSync(crypt.open(blob, aadFor(fileId, revision))).toString("utf8")) as Scene;

  const audit = (userId: string | null, action: string, target?: string) =>
    db.query(`INSERT INTO audit_log (user_id, action, target) VALUES ($1, $2, $3)`, [userId, action, target ?? null]);

  /** Loads an item the caller may `action`; otherwise 404 (never reveals existence). */
  const requireFile = async (req: FastifyRequest, action: Action) => {
    const { id } = parse(IdParams, req.params);
    const a = await accessFor(db, req.user!, id);
    if (!a || !can(a.access, action) || a.hidden || (a.trashed && a.access !== "owner")) throw new HttpError(404, "not_found");
    return { id, ...a };
  };
  const requireFileKind = async (req: FastifyRequest, action: Action) => {
    const f = await requireFile(req, action);
    if (f.kind !== "file") throw new HttpError(400, "not_a_file");
    return f;
  };

  /** Adds the CALLER's own tags to each item (tags are private; other people's tags are never shown). */
  const withTags = async (u: AuthUser, metas: FileMeta[]): Promise<FileMeta[]> => {
    if (metas.length === 0) return metas;
    const ph = metas.map((_, i) => `$${i + 2}`).join(",");
    const rows = await db.query<{ file_id: string; id: string; name: string; color: Tag["color"] }>(
      `SELECT ft.file_id, t.id, t.name, t.color FROM file_tags ft JOIN tags t ON t.id = ft.tag_id
        WHERE t.owner_id = $1 AND ft.file_id IN (${ph}) ORDER BY lower(t.name)`,
      [u.id, ...metas.map((m) => m.id)],
    );
    const byFile = new Map<string, Tag[]>();
    for (const r of rows) byFile.set(r.file_id, [...(byFile.get(r.file_id) ?? []), { id: r.id, name: r.name, color: r.color }]);
    return metas.map((m) => ({ ...m, tags: byFile.get(m.id) ?? [] }));
  };

  /** Rows that may be reachable only through a shared folder: work out the caller's real access for each. */
  const resolveRows = (rows: FileRow[], u: AuthUser) =>
    Promise.all(rows.map(async (r) => (r.owner_id === u.id ? toMeta(r, u) : toMeta(r, u, (await accessFor(db, u, r.id))?.access ?? null))));

  const loadMeta = async (u: AuthUser, id: string, access?: Access | null): Promise<FileMeta> => {
    const rows = await db.query<FileRow>(`${FILE_SELECT} WHERE f.id = $3`, [u.id, u.email, id]);
    const a = access ?? (await accessFor(db, u, id))?.access ?? null;
    return (await withTags(u, [toMeta(rows[0]!, u, a)]))[0]!;
  };

  /** How deep an item sits (1 = top level). Bounded so recursive queries stay cheap. */
  const depthOf = async (id: string): Promise<number> => {
    const r = await db.query<{ d: string | number | null }>(
      `WITH RECURSIVE up AS (
         SELECT id, parent_id, 1 AS d FROM files WHERE id = $1
         UNION ALL
         SELECT g.id, g.parent_id, up.d + 1 FROM files g JOIN up ON g.id = up.parent_id
       ) SELECT max(d) AS d FROM up`,
      [id],
    );
    return Number(r[0]?.d ?? 0);
  };

  /** New items inside someone else's shared folder belong to the folder's owner (like a shared drive). */
  const resolveParent = async (u: AuthUser, parentId?: string | null): Promise<{ ownerId: string }> => {
    if (!parentId) return { ownerId: u.id };
    const p = await accessFor(db, u, parentId);
    if (!p || p.kind !== "folder" || p.trashed || p.hidden || !can(p.access, "write")) throw new HttpError(400, "invalid_parent");
    if ((await depthOf(parentId)) >= MAX_FOLDER_DEPTH) throw new HttpError(400, "folders_too_deep", { max: MAX_FOLDER_DEPTH });
    return { ownerId: p.ownerId };
  };

  /** A per-person cap on files + folders, so one account cannot grow the database without bound. */
  const checkItemCap = async (ownerId: string) => {
    const r = await db.query<{ n: string }>(`SELECT count(*) AS n FROM files WHERE owner_id = $1`, [ownerId]);
    if (Number(r[0]!.n) >= MAX_ITEMS_PER_USER) throw new HttpError(413, "too_many_items", { max: MAX_ITEMS_PER_USER });
  };

  const checkQuota = async (ownerId: string, delta: number) => {
    const r = await db.query<{ used: string }>(`SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE owner_id = $1`, [ownerId]);
    if (Number(r[0]!.used) + delta > cfg.PER_USER_QUOTA_BYTES) throw new HttpError(413, "quota_exceeded");
  };

  const pruneVersions = (t: Db, fileId: string, latest: number) =>
    t.query(`DELETE FROM file_versions WHERE file_id = $1 AND revision <= $2`, [fileId, latest - cfg.KEEP_VERSIONS]);

  // ---------- account ----------
  api.get("/v1/me", async (req) => {
    const r = await db.query<{ used: string; files: string }>(
      `SELECT COALESCE(SUM(size), 0) AS used, COUNT(*) AS files FROM files WHERE owner_id = $1 AND deleted_at IS NULL AND kind = 'file'`,
      [req.user!.id],
    );
    return { ...req.user, usedBytes: Number(r[0]!.used), fileCount: Number(r[0]!.files), quotaBytes: cfg.PER_USER_QUOTA_BYTES };
  });

  // ---------- listing ----------
  api.get("/v1/files", async (req) => {
    const q = parse(
      z.object({
        view: ListView.default("mine"),
        q: z.string().max(100).optional(),
        parent: z.string().uuid().optional(),
        kind: z.enum(["file", "folder"]).optional(),
        tag: z.string().uuid().optional(),
      }),
      req.query,
    );
    const u = req.user!;
    const params: unknown[] = [u.id, u.email];
    const search = q.q ? (params.push(`%${q.q.replace(/[\\%_]/g, "\\$&")}%`), `AND f.name ILIKE $${params.length}`) : "";
    const kindFilter = q.kind ? (params.push(q.kind), `AND f.kind = $${params.length}`) : "";
    const byName = `ORDER BY (f.kind = 'folder') DESC, lower(f.name)`;

    // Inside a folder: its children, whoever owns them, with the folder's access flowing down.
    if (q.parent) {
      const p = await accessFor(db, u, q.parent);
      if (!p || p.kind !== "folder" || p.trashed || p.hidden) throw new HttpError(404, "not_found");
      params.push(q.parent);
      const rows = await db.query<FileRow>(
        `${FILE_SELECT} WHERE f.parent_id = $${params.length} AND f.deleted_at IS NULL ${search} ${kindFilter} ${byName} LIMIT 500`,
        params,
      );
      const info = await db.query<{ name: string; parent_id: string | null }>(`SELECT name, parent_id FROM files WHERE id = $1`, [q.parent]);
      return {
        files: await withTags(u, rows.map((r) => toMeta(r, u, p.access))),
        folder: { id: q.parent, name: info[0]!.name, parentId: info[0]!.parent_id, access: p.access },
      };
    }

    // Everything the caller tagged with one of their tags, wherever it lives.
    if (q.tag) {
      const own = await db.query(`SELECT 1 FROM tags WHERE id = $1 AND owner_id = $2`, [q.tag, u.id]);
      if (!own[0]) throw new HttpError(404, "not_found");
      params.push(q.tag);
      const rows = await db.query<FileRow>(
        `${SHARED_TREE} ${FILE_SELECT}
          WHERE f.deleted_at IS NULL AND (f.owner_id = $1 OR f.id IN (SELECT id FROM tree))
            AND EXISTS (SELECT 1 FROM file_tags ft WHERE ft.file_id = f.id AND ft.tag_id = $${params.length})
            ${NOT_UNDER_TRASH} ${search} ${kindFilter} ${byName} LIMIT 200`,
        params,
      );
      return { files: await withTags(u, await resolveRows(rows, u)) };
    }

    let prefix = "";
    let where: string;
    let order = byName;
    let limit = 200;
    switch (q.view) {
      case "mine":
        // A search looks through every folder; browsing shows only the top level.
        where = `f.owner_id = $1 AND f.deleted_at IS NULL ${q.q ? NOT_UNDER_TRASH : "AND f.parent_id IS NULL"}`;
        break;
      case "shared":
        where = `f.owner_id <> $1 AND f.deleted_at IS NULL AND (s.id IS NOT NULL OR EXISTS (
                   SELECT 1 FROM link_shares l JOIN link_access a ON a.file_id = l.file_id
                    WHERE l.file_id = f.id AND l.enabled AND a.user_id = $1))`;
        break;
      case "recent":
        prefix = SHARED_TREE;
        where = `f.kind = 'file' AND f.deleted_at IS NULL AND (f.owner_id = $1 OR f.id IN (SELECT id FROM tree)) ${NOT_UNDER_TRASH}`;
        order = `ORDER BY f.updated_at DESC`;
        limit = 20;
        break;
      case "starred":
        where = `f.owner_id = $1 AND f.starred AND f.deleted_at IS NULL ${NOT_UNDER_TRASH}`;
        break;
      case "trash":
        where = `f.owner_id = $1 AND f.deleted_at IS NOT NULL ${NOT_UNDER_TRASH}`;
        order = `ORDER BY f.deleted_at DESC`;
        break;
    }
    let rows = await db.query<FileRow>(`${prefix} ${FILE_SELECT} WHERE ${where} ${search} ${kindFilter} ${order} LIMIT ${limit}`, params);

    if (q.view === "shared" && rows.length) {
      // Show only the top of each shared tree (a shared folder, not everything inside it), like Drive.
      const ids = rows.map((r) => r.id);
      const ph = ids.map((_, i) => `$${i + 1}`).join(",");
      const anc = await db.query<{ root: string; anc: string; trashed: boolean }>(
        `WITH RECURSIVE a AS (
           SELECT id AS root, parent_id AS cur FROM files WHERE id IN (${ph})
           UNION ALL
           SELECT a.root, f.parent_id FROM files f JOIN a ON f.id = a.cur
         )
         SELECT a.root, a.cur AS anc, (p.deleted_at IS NOT NULL) AS trashed FROM a JOIN files p ON p.id = a.cur`,
        ids,
      );
      const candidate = new Set(ids);
      const drop = new Set(anc.filter((x) => candidate.has(x.anc) || x.trashed).map((x) => x.root));
      rows = rows.filter((r) => !drop.has(r.id));
    }

    // Recent can include files that are only reachable through a shared folder: resolve each properly.
    if (q.view === "recent") return { files: await withTags(u, await resolveRows(rows, u)) };
    return { files: await withTags(u, rows.map((r) => toMeta(r, u))) };
  });

  // ---------- tags (private labels) ----------
  const TAG_COUNTS = `${SHARED_TREE}
    SELECT t.id, t.name, t.color,
           (SELECT count(*) FROM file_tags ft JOIN files f ON f.id = ft.file_id
             WHERE ft.tag_id = t.id AND f.deleted_at IS NULL AND (f.owner_id = $1 OR f.id IN (SELECT id FROM tree)) ${NOT_UNDER_TRASH}) AS count
      FROM tags t WHERE t.owner_id = $1 ORDER BY lower(t.name)`;

  api.get("/v1/tags", async (req) => {
    const u = req.user!;
    const rows = await db.query<{ id: string; name: string; color: Tag["color"]; count: string | number }>(TAG_COUNTS, [u.id, u.email]);
    return { tags: rows.map((r) => ({ id: r.id, name: r.name, color: r.color, count: Number(r.count) })) };
  });

  api.post("/v1/tags", async (req, reply) => {
    const body = parse(CreateTagBody, req.body);
    const u = req.user!;
    const n = await db.query<{ n: string }>(`SELECT count(*) AS n FROM tags WHERE owner_id = $1`, [u.id]);
    if (Number(n[0]!.n) >= MAX_TAGS_PER_USER) throw new HttpError(400, "too_many_tags", { max: MAX_TAGS_PER_USER });
    try {
      const r = await db.query<{ id: string }>(`INSERT INTO tags (owner_id, name, color) VALUES ($1, $2, $3) RETURNING id`, [u.id, body.name, body.color ?? "gray"]);
      return reply.status(201).send({ id: r[0]!.id, name: body.name, color: body.color ?? "gray", count: 0 });
    } catch (e) {
      if (/tags_owner_name_idx|duplicate key/i.test(String((e as Error).message))) throw new HttpError(409, "tag_exists");
      throw e;
    }
  });

  api.patch("/v1/tags/:id", async (req) => {
    const { id } = parse(IdParams, req.params);
    const body = parse(UpdateTagBody, req.body);
    try {
      const r = await db.query<{ id: string; name: string; color: Tag["color"] }>(
        `UPDATE tags SET name = COALESCE($3, name), color = COALESCE($4, color) WHERE id = $1 AND owner_id = $2 RETURNING id, name, color`,
        [id, req.user!.id, body.name ?? null, body.color ?? null],
      );
      if (!r[0]) throw new HttpError(404, "not_found");
      return r[0];
    } catch (e) {
      if (/tags_owner_name_idx|duplicate key/i.test(String((e as Error).message))) throw new HttpError(409, "tag_exists");
      throw e;
    }
  });

  api.delete("/v1/tags/:id", async (req, reply) => {
    const { id } = parse(IdParams, req.params);
    const r = await db.query(`DELETE FROM tags WHERE id = $1 AND owner_id = $2 RETURNING id`, [id, req.user!.id]);
    if (!r[0]) throw new HttpError(404, "not_found");
    return reply.status(204).send();
  });

  /** Set the caller's tags on an item they can read (including things shared with them). */
  api.put("/v1/files/:id/tags", async (req) => {
    const f = await requireFile(req, "read");
    const body = parse(SetTagsBody, req.body);
    const u = req.user!;
    const ids = [...new Set(body.tagIds)];
    if (ids.length) {
      const ph = ids.map((_, i) => `$${i + 2}`).join(",");
      const mine = await db.query(`SELECT id FROM tags WHERE owner_id = $1 AND id IN (${ph})`, [u.id, ...ids]);
      if (mine.length !== ids.length) throw new HttpError(400, "unknown_tag");
    }
    await db.tx(async (t) => {
      await t.query(`DELETE FROM file_tags WHERE file_id = $1 AND tag_id IN (SELECT id FROM tags WHERE owner_id = $2)`, [f.id, u.id]);
      for (const tagId of ids) await t.query(`INSERT INTO file_tags (file_id, tag_id) VALUES ($1, $2)`, [f.id, tagId]);
    });
    return { tags: (await loadMeta(u, f.id, f.access)).tags };
  });

  /** Breadcrumb: from the highest folder the caller can see down to this item. */
  api.get("/v1/files/:id/path", async (req) => {
    const f = await requireFile(req, "read");
    const u = req.user!;
    const chain = await db.query<{ id: string; name: string; owner_id: string; direct: boolean }>(
      `WITH RECURSIVE chain AS (
         SELECT id, name, owner_id, parent_id, 0 AS depth FROM files WHERE id = $1
         UNION ALL
         SELECT g.id, g.name, g.owner_id, g.parent_id, c.depth + 1 FROM files g JOIN chain c ON g.id = c.parent_id
       )
       SELECT c.id, c.name, c.owner_id,
              (EXISTS (SELECT 1 FROM shares s WHERE s.file_id = c.id AND s.invited_email = $2)
               OR EXISTS (SELECT 1 FROM link_access a JOIN link_shares l ON l.file_id = a.file_id
                           WHERE a.file_id = c.id AND a.user_id = $3 AND l.enabled)) AS direct
         FROM chain c ORDER BY c.depth DESC`,
      [f.id, u.email.toLowerCase(), u.id],
    );
    const start = chain.findIndex((c) => c.owner_id === u.id || c.direct);
    return { path: chain.slice(start < 0 ? 0 : start).map((c) => ({ id: c.id, name: c.name })) };
  });

  // ---------- create ----------
  api.post("/v1/files", async (req, reply) => {
    const body = parse(CreateFileBody, req.body);
    const u = req.user!;
    const { raw, gz } = encodeScene(body.scene);
    const { ownerId } = await resolveParent(u, body.parentId);
    await checkItemCap(ownerId);
    await checkQuota(ownerId, raw);
    const id = await db.tx(async (t) => {
      const f = await t.query<{ id: string }>(
        `INSERT INTO files (owner_id, name, parent_id, size, kind) VALUES ($1, $2, $3, $4, 'file') RETURNING id`,
        [ownerId, body.name, body.parentId ?? null, raw],
      );
      await t.query(`INSERT INTO file_versions (file_id, revision, scene, created_by) VALUES ($1, 1, $2, $3)`, [f[0]!.id, sealScene(gz, f[0]!.id, 1), u.id]);
      return f[0]!.id;
    });
    await audit(u.id, "file.create", id);
    return reply.status(201).send(await loadMeta(u, id));
  });

  api.post("/v1/folders", async (req, reply) => {
    const body = parse(CreateFolderBody, req.body);
    const u = req.user!;
    const { ownerId } = await resolveParent(u, body.parentId);
    await checkItemCap(ownerId);
    const r = await db.query<{ id: string }>(
      `INSERT INTO files (owner_id, name, parent_id, size, kind) VALUES ($1, $2, $3, 0, 'folder') RETURNING id`,
      [ownerId, body.name, body.parentId ?? null],
    );
    await audit(u.id, "folder.create", r[0]!.id);
    return reply.status(201).send(await loadMeta(u, r[0]!.id));
  });

  // ---------- read / save ----------
  api.get("/v1/files/:id", async (req) => {
    const f = await requireFile(req, "read");
    const meta = await loadMeta(req.user!, f.id, f.access);
    if (f.kind === "folder") return meta;
    const v = await db.query<{ scene: Uint8Array }>(`SELECT scene FROM file_versions WHERE file_id = $1 AND revision = $2`, [f.id, meta.revision]);
    if (!v[0]) throw new HttpError(500, "missing_version");
    return { ...meta, scene: decodeScene(v[0].scene, f.id, meta.revision) };
  });

  api.put("/v1/files/:id", async (req) => {
    const f = await requireFileKind(req, "write");
    if (f.trashed) throw new HttpError(404, "not_found");
    const body = parse(SaveFileBody, req.body);
    const ifMatch = req.headers["if-match"];
    const expected = Number(String(ifMatch ?? "").replace(/"/g, ""));
    if (!Number.isInteger(expected) || expected < 1) throw new HttpError(428, "if_match_required");
    const { raw, gz } = encodeScene(body.scene);
    const cur = await db.query<{ size: number }>(`SELECT size FROM files WHERE id = $1`, [f.id]);
    await checkQuota(f.ownerId, Math.max(0, raw - (cur[0]?.size ?? 0)));
    const result = await db.tx(async (t) => {
      const up = await t.query<{ revision: number; updated_at: string }>(
        `UPDATE files SET revision = revision + 1, size = $3, name = COALESCE($4, name), updated_at = now()
          WHERE id = $1 AND revision = $2 RETURNING revision, updated_at`,
        [f.id, expected, raw, body.name ?? null],
      );
      if (!up[0]) return null;
      await t.query(`INSERT INTO file_versions (file_id, revision, scene, created_by) VALUES ($1, $2, $3, $4)`, [f.id, up[0].revision, sealScene(gz, f.id, up[0].revision), req.user!.id]);
      await pruneVersions(t, f.id, up[0].revision);
      return up[0];
    });
    if (!result) {
      const c = await db.query<{ revision: number }>(`SELECT revision FROM files WHERE id = $1`, [f.id]);
      throw new HttpError(409, "conflict", { currentRevision: c[0]!.revision });
    }
    return { revision: result.revision, updatedAt: new Date(result.updated_at).toISOString() };
  });

  // ---------- rename / star / move / trash ----------
  api.patch("/v1/files/:id", async (req) => {
    const body = parse(PatchFileBody, req.body);
    const u = req.user!;
    const onlyName = Object.keys(body).every((k) => k === "name");
    const f = await requireFile(req, onlyName ? "write" : "manage");
    if (f.trashed && body.trashed !== false) throw new HttpError(409, "file_in_trash");
    if ("parentId" in body && body.parentId) {
      // Only owners move things, and only into folders they own, so a tree always has a single owner.
      const p = await accessFor(db, u, body.parentId);
      if (!p || p.kind !== "folder" || p.access !== "owner" || p.trashed || p.hidden || body.parentId === f.id) throw new HttpError(400, "invalid_parent");
      const loop = await db.query(
        `WITH RECURSIVE up AS (
           SELECT id, parent_id FROM files WHERE id = $1
           UNION ALL
           SELECT g.id, g.parent_id FROM files g JOIN up ON g.id = up.parent_id
         ) SELECT 1 FROM up WHERE id = $2`,
        [body.parentId, f.id],
      );
      if (loop.length) throw new HttpError(400, "cannot_move_into_itself");
    }
    await db.query(
      `UPDATE files SET
         name = COALESCE($2, name),
         starred = COALESCE($3, starred),
         parent_id = CASE WHEN $4::boolean THEN $5::uuid ELSE parent_id END,
         deleted_at = CASE WHEN $6::boolean IS NULL THEN deleted_at WHEN $6::boolean THEN now() ELSE NULL END
       WHERE id = $1`,
      [f.id, body.name ?? null, body.starred ?? null, "parentId" in body, body.parentId ?? null, body.trashed ?? null],
    );
    if (body.trashed !== undefined) await audit(u.id, body.trashed ? "file.trash" : "file.restore", f.id);
    if ("parentId" in body) await audit(u.id, "file.move", `${f.id}->${body.parentId ?? "root"}`);
    return loadMeta(u, f.id);
  });

  api.delete("/v1/files/:id", async (req, reply) => {
    const f = await requireFile(req, "manage");
    const { permanent } = parse(z.object({ permanent: z.enum(["0", "1"]).default("0") }), req.query);
    if (permanent === "1") {
      if (!f.trashed) throw new HttpError(409, "move_to_trash_first");
      await db.query(`DELETE FROM files WHERE id = $1`, [f.id]); // folders take everything inside with them
      await audit(req.user!.id, "file.delete", f.id);
    } else {
      await db.query(`UPDATE files SET deleted_at = now() WHERE id = $1`, [f.id]);
      await audit(req.user!.id, "file.trash", f.id);
    }
    return reply.status(204).send();
  });

  // ---------- versions ----------
  api.get("/v1/files/:id/versions", async (req) => {
    const f = await requireFileKind(req, "read");
    const rows = await db.query<{ revision: number; created_at: string; by: string }>(
      `SELECT v.revision, v.created_at, u.name AS by FROM file_versions v JOIN users u ON u.id = v.created_by
        WHERE v.file_id = $1 ORDER BY v.revision DESC`,
      [f.id],
    );
    return { versions: rows.map((r) => ({ revision: r.revision, createdAt: new Date(r.created_at).toISOString(), by: r.by })) };
  });

  api.get("/v1/files/:id/versions/:rev", async (req) => {
    const f = await requireFileKind(req, "read");
    const { rev } = parse(z.object({ rev: z.coerce.number().int().min(1) }), req.params);
    const v = await db.query<{ scene: Uint8Array }>(`SELECT scene FROM file_versions WHERE file_id = $1 AND revision = $2`, [f.id, rev]);
    if (!v[0]) throw new HttpError(404, "not_found");
    return { revision: rev, scene: decodeScene(v[0].scene, f.id, rev) };
  });

  api.post("/v1/files/:id/versions/:rev/restore", async (req) => {
    const f = await requireFileKind(req, "write");
    const { rev } = parse(z.object({ rev: z.coerce.number().int().min(1) }), req.params);
    const v = await db.query<{ scene: Uint8Array }>(`SELECT scene FROM file_versions WHERE file_id = $1 AND revision = $2`, [f.id, rev]);
    if (!v[0]) throw new HttpError(404, "not_found");
    const scene = decodeScene(v[0].scene, f.id, rev);
    const { raw, gz } = encodeScene(scene);
    const out = await db.tx(async (t) => {
      const up = await t.query<{ revision: number; updated_at: string }>(
        `UPDATE files SET revision = revision + 1, size = $2, updated_at = now() WHERE id = $1 RETURNING revision, updated_at`,
        [f.id, raw],
      );
      await t.query(`INSERT INTO file_versions (file_id, revision, scene, created_by) VALUES ($1, $2, $3, $4)`, [f.id, up[0]!.revision, sealScene(gz, f.id, up[0]!.revision), req.user!.id]);
      await pruneVersions(t, f.id, up[0]!.revision);
      return up[0]!;
    });
    return { revision: out.revision, updatedAt: new Date(out.updated_at).toISOString() };
  });

  // ---------- sharing (people) ----------
  api.get("/v1/files/:id/shares", async (req): Promise<SharingInfo> => {
    const f = await requireFile(req, "manage");
    const owner = await db.query<{ name: string; email: string }>(`SELECT name, email FROM users WHERE id = $1`, [f.ownerId]);
    const direct = await db.query<{ id: string; invited_email: string; role: "viewer" | "editor"; created_at: string }>(
      `SELECT id, invited_email, role, created_at FROM shares WHERE file_id = $1 ORDER BY created_at`,
      [f.id],
    );
    const inherited = await db.query<{ id: string; invited_email: string; role: "viewer" | "editor"; from_id: string; from_name: string }>(
      `WITH RECURSIVE up AS (
         SELECT parent_id AS pid FROM files WHERE id = $1
         UNION ALL
         SELECT g.parent_id FROM files g JOIN up ON g.id = up.pid
       )
       SELECT s.id, s.invited_email, s.role, p.id AS from_id, p.name AS from_name
         FROM up JOIN files p ON p.id = up.pid JOIN shares s ON s.file_id = p.id ORDER BY s.created_at`,
      [f.id],
    );
    const link = await db.query<{ role: "viewer" | "editor"; enabled: boolean; token_enc: Uint8Array }>(
      `SELECT role, enabled, token_enc FROM link_shares WHERE file_id = $1`,
      [f.id],
    );
    const l = link[0];
    return {
      owner: owner[0]!,
      shares: direct.map((r) => ({ id: r.id, email: r.invited_email, role: r.role, createdAt: new Date(r.created_at).toISOString() })),
      inherited: inherited.map((r) => ({ id: r.id, email: r.invited_email, role: r.role, fromId: r.from_id, fromName: r.from_name })),
      link: {
        enabled: l?.enabled ?? false,
        role: l?.role ?? "viewer",
        token: l?.enabled ? crypt.open(l.token_enc, `link:${f.id}`).toString("utf8") : null,
      },
    };
  });

  api.post("/v1/files/:id/shares", async (req, reply) => {
    const f = await requireFile(req, "manage");
    const body = parse(AddShareBody, req.body);
    const email = body.email.toLowerCase();
    if (email === req.user!.email.toLowerCase()) throw new HttpError(400, "cannot_share_with_self");
    const rows = await db.query<{ id: string }>(
      `INSERT INTO shares (file_id, invited_email, role, created_by) VALUES ($1, $2, $3, $4)
       ON CONFLICT (file_id, invited_email) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
      [f.id, email, body.role, req.user!.id],
    );
    await audit(req.user!.id, "share.add", `${f.id}:${email}:${body.role}`);
    return reply.status(201).send({ id: rows[0]!.id, email, role: body.role });
  });

  api.patch("/v1/files/:id/shares/:shareId", async (req) => {
    const f = await requireFile(req, "manage");
    const { shareId } = parse(z.object({ shareId: z.string().uuid() }), req.params);
    const body = parse(UpdateShareBody, req.body);
    const r = await db.query<{ id: string }>(`UPDATE shares SET role = $3 WHERE id = $1 AND file_id = $2 RETURNING id`, [shareId, f.id, body.role]);
    if (!r[0]) throw new HttpError(404, "not_found");
    await audit(req.user!.id, "share.role", `${f.id}:${shareId}:${body.role}`);
    return { id: shareId, role: body.role };
  });

  api.delete("/v1/files/:id/shares/:shareId", async (req, reply) => {
    const f = await requireFile(req, "manage");
    const { shareId } = parse(z.object({ shareId: z.string().uuid() }), req.params);
    await db.query(`DELETE FROM shares WHERE id = $1 AND file_id = $2`, [shareId, f.id]);
    await audit(req.user!.id, "share.remove", `${f.id}:${shareId}`);
    return reply.status(204).send();
  });

  /** Remove something that was shared with you from your own "Shared with me". */
  api.post("/v1/files/:id/leave", async (req, reply) => {
    const f = await requireFile(req, "read");
    const u = req.user!;
    if (f.access === "owner") throw new HttpError(400, "owner_cannot_leave");
    const a = await db.query(`DELETE FROM shares WHERE file_id = $1 AND invited_email = $2 RETURNING id`, [f.id, u.email.toLowerCase()]);
    const b = await db.query(`DELETE FROM link_access WHERE file_id = $1 AND user_id = $2 RETURNING file_id`, [f.id, u.id]);
    // Access that comes from a shared parent folder cannot be dropped here: leave that folder instead.
    if (a.length === 0 && b.length === 0) throw new HttpError(409, "access_inherited");
    await audit(u.id, "share.leave", f.id);
    return reply.status(204).send();
  });

  // ---------- sharing (anyone with the link) ----------
  api.put("/v1/files/:id/link", async (req) => {
    const f = await requireFile(req, "manage");
    const body = parse(SetLinkBody, req.body);
    const existing = await db.query<{ role: "viewer" | "editor"; token_enc: Uint8Array }>(`SELECT role, token_enc FROM link_shares WHERE file_id = $1`, [f.id]);
    let token: string | null = null;
    let role: "viewer" | "editor" = body.role ?? existing[0]?.role ?? "viewer";
    if (!existing[0]) {
      if (!body.enabled) return { enabled: false, role, token: null };
      token = randomBytes(32).toString("base64url");
      await db.query(
        `INSERT INTO link_shares (file_id, token_hash, token_enc, role, enabled, created_by) VALUES ($1, $2, $3, $4, true, $5)`,
        [f.id, sha256(token), crypt.seal(Buffer.from(token), `link:${f.id}`), role, req.user!.id],
      );
    } else {
      await db.query(`UPDATE link_shares SET enabled = $2, role = $3 WHERE file_id = $1`, [f.id, body.enabled, role]);
      if (body.enabled) token = crypt.open(existing[0].token_enc, `link:${f.id}`).toString("utf8");
    }
    // Turning the link off cuts off everyone who came in through it; they must reopen the link if it is turned back on.
    if (!body.enabled) await db.query(`DELETE FROM link_access WHERE file_id = $1`, [f.id]);
    role = body.role ?? role;
    await audit(req.user!.id, body.enabled ? "link.on" : "link.off", `${f.id}:${role}`);
    return { enabled: body.enabled, role, token };
  });

  /** A signed-in person opened a share link: remember it so the item shows up in "Shared with me". */
  api.post(
    "/v1/links/:token/redeem",
    { config: { rateLimit: { max: process.env.NODE_ENV === "test" ? 100000 : 30, timeWindow: "1 minute" } } },
    async (req) => {
      const { token } = parse(z.object({ token: z.string().min(20).max(100) }), req.params);
      const u = req.user!;
      const l = await db.query<{ file_id: string }>(`SELECT file_id FROM link_shares WHERE token_hash = $1 AND enabled`, [sha256(token)]);
      if (!l[0]) throw new HttpError(404, "not_found");
      const fileId = l[0].file_id;
      await db.query(`INSERT INTO link_access (user_id, file_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [u.id, fileId]);
      const a = await accessFor(db, u, fileId);
      if (!a || a.hidden || (a.trashed && a.access !== "owner")) throw new HttpError(404, "not_found");
      const meta = await db.query<{ name: string }>(`SELECT name FROM files WHERE id = $1`, [fileId]);
      await audit(u.id, "link.redeem", fileId);
      return { id: fileId, name: meta[0]!.name, kind: a.kind, access: a.access };
    },
  );
}
