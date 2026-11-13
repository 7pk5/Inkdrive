import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { migrate, openMemory, type Db } from "../src/db.js";

let app: FastifyInstance;
let db: Db;

const scene = (n = 1) => ({ type: "excalidraw" as const, version: 2, elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}` })), appState: {}, files: {} });

async function login(email: string, name = email) {
  const r = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { email, name } });
  expect(r.statusCode).toBe(200);
  const b = r.json();
  return { token: b.accessToken as string, refresh: b.refreshToken as string, id: b.user.id as string };
}
const auth = (t: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${t}`, ...extra });

async function createFile(token: string, name = "Doc") {
  const r = await app.inject({ method: "POST", url: "/v1/files", headers: auth(token), payload: { name, scene: scene() } });
  expect(r.statusCode).toBe(201);
  return r.json() as { id: string; revision: number };
}

beforeAll(async () => {
  const cfg = loadConfig({
    JWT_SECRET: "x".repeat(40),
    DEV_AUTH: "1",
    PER_USER_QUOTA_BYTES: String(50_000),
    KEEP_VERSIONS: "3",
  });
  db = await openMemory();
  await migrate(db);
  app = await buildApp(cfg, db);
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe("auth", () => {
  it("rejects requests without a token", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/files" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/files", headers: auth("garbage") })).statusCode).toBe(401);
  });

  it("rotates refresh tokens and revokes the family on reuse", async () => {
    const a = await login("rot@example.com");
    const r1 = await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: a.refresh } });
    expect(r1.statusCode).toBe(200);
    const newRefresh = r1.json().refreshToken as string;
    // reusing the old token = leak: rejected AND the new one stops working
    expect((await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: a.refresh } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/v1/auth/refresh", payload: { refreshToken: newRefresh } })).statusCode).toBe(401);
  });

  it("reports storage usage on /v1/me", async () => {
    const u = await login("usage@example.com");
    await createFile(u.token, "One");
    const me = (await app.inject({ method: "GET", url: "/v1/me", headers: auth(u.token) })).json();
    expect(me.email).toBe("usage@example.com");
    expect(me.fileCount).toBe(1);
    expect(me.usedBytes).toBeGreaterThan(0);
    expect(me.quotaBytes).toBe(50_000);
  });

  it("serves meta without auth", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/meta" });
    expect(r.json().apiVersion).toBe("v1");
  });
});

describe("files", () => {
  it("creates, lists, loads and saves with optimistic concurrency", async () => {
    const u = await login("owner1@example.com");
    const f = await createFile(u.token, "Checkout flow");
    expect(f.revision).toBe(1);

    const list = await app.inject({ method: "GET", url: "/v1/files?view=mine", headers: auth(u.token) });
    expect(list.json().files.map((x: { name: string }) => x.name)).toContain("Checkout flow");

    const get = await app.inject({ method: "GET", url: `/v1/files/${f.id}`, headers: auth(u.token) });
    expect(get.json().scene.elements).toHaveLength(1);

    const save = await app.inject({ method: "PUT", url: `/v1/files/${f.id}`, headers: auth(u.token, { "if-match": "1" }), payload: { scene: scene(3) } });
    expect(save.statusCode).toBe(200);
    expect(save.json().revision).toBe(2);

    // stale revision -> 409 with the current revision
    const stale = await app.inject({ method: "PUT", url: `/v1/files/${f.id}`, headers: auth(u.token, { "if-match": "1" }), payload: { scene: scene(4) } });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().currentRevision).toBe(2);

    // missing If-Match -> 428
    const nomatch = await app.inject({ method: "PUT", url: `/v1/files/${f.id}`, headers: auth(u.token), payload: { scene: scene() } });
    expect(nomatch.statusCode).toBe(428);
  });

  it("rejects bodies that are not Excalidraw scenes", async () => {
    const u = await login("owner2@example.com");
    const r = await app.inject({ method: "POST", url: "/v1/files", headers: auth(u.token), payload: { name: "x", scene: { hello: 1 } } });
    expect(r.statusCode).toBe(400);
  });

  it("keeps only the configured number of versions and can restore one", async () => {
    const u = await login("owner3@example.com");
    const f = await createFile(u.token);
    for (let rev = 1; rev <= 5; rev++) {
      const r = await app.inject({ method: "PUT", url: `/v1/files/${f.id}`, headers: auth(u.token, { "if-match": String(rev) }), payload: { scene: scene(rev + 1) } });
      expect(r.statusCode).toBe(200);
    }
    const vs = (await app.inject({ method: "GET", url: `/v1/files/${f.id}/versions`, headers: auth(u.token) })).json().versions;
    expect(vs.map((v: { revision: number }) => v.revision)).toEqual([6, 5, 4]);

    const restore = await app.inject({ method: "POST", url: `/v1/files/${f.id}/versions/4/restore`, headers: auth(u.token) });
    expect(restore.json().revision).toBe(7);
    const cur = (await app.inject({ method: "GET", url: `/v1/files/${f.id}`, headers: auth(u.token) })).json();
    expect(cur.scene.elements).toHaveLength(4); // rev 4 had rev+1 = 4 elements
  });

  it("enforces the per-user quota", async () => {
    const u = await login("quota@example.com");
    const big = { type: "excalidraw", elements: [{ blob: "y".repeat(40_000) }] };
    expect((await app.inject({ method: "POST", url: "/v1/files", headers: auth(u.token), payload: { name: "a", scene: big } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/v1/files", headers: auth(u.token), payload: { name: "b", scene: big } })).statusCode).toBe(413);
  });

  it("trash, restore and permanent delete", async () => {
    const u = await login("trash@example.com");
    const f = await createFile(u.token, "Gone");
    expect((await app.inject({ method: "DELETE", url: `/v1/files/${f.id}?permanent=1`, headers: auth(u.token) })).statusCode).toBe(409);
    expect((await app.inject({ method: "DELETE", url: `/v1/files/${f.id}`, headers: auth(u.token) })).statusCode).toBe(204);
    const trash = (await app.inject({ method: "GET", url: "/v1/files?view=trash", headers: auth(u.token) })).json().files;
    expect(trash.map((x: { id: string }) => x.id)).toContain(f.id);
    const back = await app.inject({ method: "PATCH", url: `/v1/files/${f.id}`, headers: auth(u.token), payload: { trashed: false } });
    expect(back.json().trashed).toBe(false);
    await app.inject({ method: "DELETE", url: `/v1/files/${f.id}`, headers: auth(u.token) });
    expect((await app.inject({ method: "DELETE", url: `/v1/files/${f.id}?permanent=1`, headers: auth(u.token) })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: `/v1/files/${f.id}`, headers: auth(u.token) })).statusCode).toBe(404);
  });
});

describe("encryption at rest", () => {
  it("stores drawings encrypted, still serves them, and rejects swapped blobs", async () => {
    const u = await login("crypt@example.com");
    const marker = "TOP-SECRET-MARKER-12345";
    const mk = async (name: string) =>
      (await app.inject({ method: "POST", url: "/v1/files", headers: auth(u.token), payload: { name, scene: { type: "excalidraw", elements: [{ text: marker }] } } })).json() as { id: string };
    const a = await mk("A");
    const b = await mk("B");

    const rows = await db.query<{ scene: Uint8Array }>(`SELECT scene FROM file_versions WHERE file_id = $1`, [a.id]);
    const stored = Buffer.from(rows[0]!.scene);
    expect(stored[0]).toBe(0xec); // sealed, not plain gzip
    expect(stored.includes(Buffer.from(marker))).toBe(false);

    const ok = await app.inject({ method: "GET", url: `/v1/files/${a.id}`, headers: auth(u.token) });
    expect(JSON.stringify(ok.json().scene)).toContain(marker);

    // copy A's ciphertext onto B's row: must not decrypt
    await db.query(`UPDATE file_versions SET scene = $1 WHERE file_id = $2`, [stored, b.id]);
    const swapped = await app.inject({ method: "GET", url: `/v1/files/${b.id}`, headers: auth(u.token) });
    expect(swapped.statusCode).toBe(500);
  });
});

describe("isolation between users (every file route)", () => {
  it("answers 404 to a stranger on every route", async () => {
    const owner = await login("iso-owner@example.com");
    const stranger = await login("iso-stranger@example.com");
    const f = await createFile(owner.token, "Private");
    const id = f.id;
    const h = auth(stranger.token, { "if-match": "1" });
    const calls: [string, string, unknown?][] = [
      ["GET", `/v1/files/${id}`],
      ["PUT", `/v1/files/${id}`, { scene: scene() }],
      ["PATCH", `/v1/files/${id}`, { name: "hacked" }],
      ["DELETE", `/v1/files/${id}`],
      ["GET", `/v1/files/${id}/versions`],
      ["GET", `/v1/files/${id}/versions/1`],
      ["POST", `/v1/files/${id}/versions/1/restore`],
    ];
    for (const [method, url, payload] of calls) {
      const r = await app.inject({ method: method as "GET", url, headers: h, payload: payload as object | undefined });
      expect(r.statusCode, `${method} ${url}`).toBe(404);
    }
    const list = (await app.inject({ method: "GET", url: "/v1/files?view=mine", headers: auth(stranger.token) })).json().files;
    expect(list).toHaveLength(0);
    const untouched = (await app.inject({ method: "GET", url: `/v1/files/${id}`, headers: auth(owner.token) })).json();
    expect(untouched.name).toBe("Private");
  });
});

describe("no sharing", () => {
  it("has no share or link routes, and leftover share rows from an older version grant nothing", async () => {
    const owner = await login("ns-owner@example.com");
    const other = await login("ns-other@example.com");
    const f = await createFile(owner.token, "Mine");
    for (const [m, u] of [["POST", `/v1/files/${f.id}/shares`], ["GET", `/v1/files/${f.id}/shares`], ["PUT", `/v1/files/${f.id}/link`], ["POST", `/v1/files/${f.id}/leave`], ["GET", "/s/abcdefghijklmnopqrstuvwxyz"]] as const) {
      expect((await app.inject({ method: m, url: u, headers: auth(owner.token), payload: m === "GET" ? undefined : {} })).statusCode, `${m} ${u}`).toBe(404);
    }
    // a row left in the old tables (from before sharing was removed) must not open the file
    await db.query(`INSERT INTO shares (file_id, invited_email, role, created_by) VALUES ($1, $2, 'editor', $3)`, [f.id, "ns-other@example.com", owner.id]);
    expect((await app.inject({ method: "GET", url: `/v1/files/${f.id}`, headers: auth(other.token) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/v1/files?view=mine", headers: auth(other.token) })).json().files).toHaveLength(0);
    expect((await app.inject({ method: "GET", url: "/v1/files?view=shared", headers: auth(other.token) })).statusCode).toBe(400);
  });
});
