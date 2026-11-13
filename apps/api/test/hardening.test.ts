import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { migrate, openMemory, type Db } from "../src/db.js";
import { MAX_FOLDER_DEPTH } from "../src/files.js";
import { runMaintenance } from "../src/maintenance.js";

let app: FastifyInstance;
let db: Db;
const scene = () => ({ type: "excalidraw" as const, elements: [] });

async function login(email: string) {
  const r = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { email, name: email.split("@")[0] } });
  return { token: r.json().accessToken as string, id: r.json().user.id as string, email };
}
type U = Awaited<ReturnType<typeof login>>;
const call = async (u: U, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer ${u.token}` }, payload: payload as object | undefined });
  return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as any) : null };
};

beforeAll(async () => {
  db = await openMemory();
  await migrate(db);
  app = await buildApp(loadConfig({ JWT_SECRET: "h".repeat(40), DEV_AUTH: "1" }), db);
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe("configuration safety", () => {
  const base = { JWT_SECRET: "s".repeat(40) };
  it("refuses dev login together with a real database", () => {
    expect(() => loadConfig({ ...base, DEV_AUTH: "1", DATABASE_URL: "postgres://x/y", DATA_KEY: Buffer.alloc(32).toString("base64") })).toThrow(/DEV_AUTH/);
  });
  it("refuses a real database without a data key", () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: "postgres://x/y" })).toThrow(/DATA_KEY/);
  });
  it("refuses a short JWT secret", () => {
    expect(() => loadConfig({ JWT_SECRET: "short" })).toThrow();
  });
  it("does not register the dev login route unless enabled", async () => {
    const off = await buildApp(loadConfig(base), db);
    const r = await off.inject({ method: "POST", url: "/v1/auth/dev", payload: { email: "a@b.com" } });
    expect(r.statusCode).toBe(404);
    await off.close();
  });
});

describe("health", () => {
  it("reports ok when the database answers", async () => {
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ ok: true });
  });
  it("reports 503 when it does not", async () => {
    const broken = { ...db, query: async () => { throw new Error("db down"); } } as unknown as Db;
    const a = await buildApp(loadConfig({ JWT_SECRET: "s".repeat(40) }), broken);
    expect((await a.inject({ method: "GET", url: "/health" })).statusCode).toBe(503);
    await a.close();
  });
});

describe("limits", () => {
  it("stops folders nesting past the maximum depth", async () => {
    const u = await login("deep@example.com");
    let parent: string | undefined;
    for (let i = 0; i < MAX_FOLDER_DEPTH; i++) {
      const r = await call(u, "POST", "/v1/folders", { name: `f${i}`, parentId: parent });
      expect(r.status).toBe(201);
      parent = r.body.id;
    }
    const tooDeep = await call(u, "POST", "/v1/folders", { name: "one more", parentId: parent });
    expect(tooDeep.status).toBe(400);
    expect(tooDeep.body.error).toBe("folders_too_deep");
    expect((await call(u, "POST", "/v1/files", { name: "x", scene: scene(), parentId: parent })).status).toBe(400);
  });
});

describe("leaving shared items", () => {
  it("says so when access comes from a shared folder instead of pretending to remove it", async () => {
    const owner = await login("lvo@example.com");
    const guest = await login("lvg@example.com");
    const top = (await call(owner, "POST", "/v1/folders", { name: "Top" })).body.id as string;
    const doc = (await call(owner, "POST", "/v1/files", { name: "Doc", scene: scene(), parentId: top })).body.id as string;
    await call(owner, "POST", `/v1/files/${top}/shares`, { email: guest.email, role: "viewer" });
    const r = await call(guest, "POST", `/v1/files/${doc}/leave`);
    expect(r.status).toBe(409);
    expect(r.body.error).toBe("access_inherited");
    expect((await call(guest, "POST", `/v1/files/${top}/leave`)).status).toBe(204); // leaving the folder works
    expect((await call(guest, "GET", `/v1/files/${doc}`)).status).toBe(404);
  });
});

describe("maintenance", () => {
  it("removes old sessions and audit rows but keeps recent ones", async () => {
    const u = await login("mt@example.com");
    await db.query(`INSERT INTO sessions (user_id, family_id, token_hash, expires_at) VALUES ($1, gen_random_uuid(), 'old-expired', now() - interval '10 days')`, [u.id]);
    await db.query(`INSERT INTO sessions (user_id, family_id, token_hash, expires_at, revoked_at) VALUES ($1, gen_random_uuid(), 'old-revoked', now() + interval '1 day', now() - interval '40 days')`, [u.id]);
    await db.query(`INSERT INTO sessions (user_id, family_id, token_hash, expires_at, revoked_at) VALUES ($1, gen_random_uuid(), 'fresh-revoked', now() + interval '1 day', now() - interval '2 days')`, [u.id]);
    await db.query(`INSERT INTO audit_log (user_id, action, at) VALUES ($1, 'ancient', now() - interval '200 days'), ($1, 'recent', now() - interval '1 day')`, [u.id]);

    const r = await runMaintenance(db);
    expect(r.sessions).toBe(2);
    expect(r.audit).toBe(1);
    const left = (await db.query<{ token_hash: string }>(`SELECT token_hash FROM sessions WHERE token_hash IN ('old-expired','old-revoked','fresh-revoked')`)).map((x) => x.token_hash);
    expect(left).toEqual(["fresh-revoked"]);
    expect((await db.query(`SELECT 1 FROM audit_log WHERE action = 'recent'`)).length).toBe(1);
    expect((await call(u, "GET", "/v1/me")).status).toBe(200); // a live login is untouched
  });
});
