import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { migrate, openMemory, type Db } from "../src/db.js";

let app: FastifyInstance;
let db: Db;

const scene = (n = 1) => ({ type: "excalidraw" as const, elements: Array.from({ length: n }, (_, i) => ({ id: `e${i}` })) });
const auth = (t: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${t}`, ...extra });

async function login(email: string, name = email.split("@")[0]!) {
  const r = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { email, name } });
  return { token: r.json().accessToken as string, id: r.json().user.id as string, email };
}
type U = Awaited<ReturnType<typeof login>>;

const call = async (u: U, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown, headers: Record<string, string> = {}) => {
  const r = await app.inject({ method, url, headers: auth(u.token, headers), payload: payload as object | undefined });
  return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as any) : null };
};
const folder = async (u: U, name: string, parentId?: string) => (await call(u, "POST", "/v1/folders", { name, parentId })).body as { id: string };
const file = async (u: U, name: string, parentId?: string) => (await call(u, "POST", "/v1/files", { name, scene: scene(), parentId })).body as { id: string; revision: number };
const names = (r: { body: { files: { name: string }[] } }) => r.body.files.map((f) => f.name);

beforeAll(async () => {
  db = await openMemory();
  await migrate(db);
  app = await buildApp(loadConfig({ JWT_SECRET: "y".repeat(40), DEV_AUTH: "1", KEEP_VERSIONS: "5" }), db);
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe("folders", () => {
  it("nests, lists folders first, and gives breadcrumbs", async () => {
    const u = await login("f1@example.com");
    const a = await folder(u, "Projects");
    const b = await folder(u, "Design", a.id);
    await file(u, "Zebra", a.id);
    await file(u, "Root file");

    const root = await call(u, "GET", "/v1/files?view=mine");
    expect(names(root as any)).toEqual(["Projects", "Root file"]); // top level only, folder first

    const inside = await call(u, "GET", `/v1/files?parent=${a.id}`);
    expect(names(inside as any)).toEqual(["Design", "Zebra"]);
    expect(inside.body.folder.name).toBe("Projects");

    const path = await call(u, "GET", `/v1/files/${b.id}/path`);
    expect(path.body.path.map((p: { name: string }) => p.name)).toEqual(["Projects", "Design"]);

    // search looks through every folder
    const found = await call(u, "GET", "/v1/files?view=mine&q=zebra");
    expect(names(found as any)).toEqual(["Zebra"]);
  });

  it("moves items, refuses loops, and only the owner may move", async () => {
    const owner = await login("mv-owner@example.com");
    const top = await folder(owner, "Top");
    const sub = await folder(owner, "Sub", top.id);
    const f = await file(owner, "Doc");

    expect((await call(owner, "PATCH", `/v1/files/${f.id}`, { parentId: sub.id })).status).toBe(200);
    expect((await call(owner, "GET", `/v1/files?parent=${sub.id}`)).body.files.map((x: { id: string }) => x.id)).toContain(f.id);
    expect((await call(owner, "PATCH", `/v1/files/${top.id}`, { parentId: sub.id })).status).toBe(400); // into own child
    expect((await call(owner, "PATCH", `/v1/files/${top.id}`, { parentId: top.id })).status).toBe(400); // into itself
    expect((await call(owner, "PATCH", `/v1/files/${f.id}`, { parentId: null })).status).toBe(200); // back to root

    const inTop = await file(owner, "In top", top.id);
    expect((await call(await login("mv-stranger@example.com"), "PATCH", `/v1/files/${inTop.id}`, { parentId: null })).status).toBe(404); // others cannot move
  });
});

describe("trash and delete with folders", () => {
  it("hides the contents of a trashed folder, restores them with it, and deletes them forever with it", async () => {
    const u = await login("tr@example.com");
    const top = await folder(u, "Old project");
    const doc = await file(u, "Inside", top.id);

    expect((await call(u, "DELETE", `/v1/files/${top.id}`)).status).toBe(204);
    expect((await call(u, "GET", `/v1/files/${doc.id}`)).status).toBe(404); // unreachable while the folder is trashed
    expect(names((await call(u, "GET", "/v1/files?view=trash")) as any)).toEqual(["Old project"]); // not the contents
    expect(names((await call(u, "GET", "/v1/files?view=recent")) as any)).not.toContain("Inside");

    expect((await call(u, "PATCH", `/v1/files/${top.id}`, { trashed: false })).status).toBe(200);
    expect((await call(u, "GET", `/v1/files/${doc.id}`)).status).toBe(200);

    await call(u, "DELETE", `/v1/files/${top.id}`);
    expect((await call(u, "DELETE", `/v1/files/${top.id}?permanent=1`)).status).toBe(204);
    expect((await db.query(`SELECT 1 FROM files WHERE id = $1`, [doc.id])).length).toBe(0); // cascade
  });

  it("rejects file-only operations on folders", async () => {
    const u = await login("fo@example.com");
    const top = await folder(u, "Just a folder");
    expect((await call(u, "PUT", `/v1/files/${top.id}`, { scene: scene() }, { "if-match": "1" })).status).toBe(400);
    expect((await call(u, "GET", `/v1/files/${top.id}/versions`)).status).toBe(400);
    expect((await call(u, "GET", `/v1/files/${top.id}`)).body.kind).toBe("folder");
  });
});
