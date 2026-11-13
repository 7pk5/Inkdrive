import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { migrate, openMemory, type Db } from "../src/db.js";

let app: FastifyInstance;
let db: Db;
const scene = () => ({ type: "excalidraw" as const, elements: [] });

async function login(email: string) {
  const r = await app.inject({ method: "POST", url: "/v1/auth/dev", payload: { email, name: email.split("@")[0] } });
  return { token: r.json().accessToken as string, id: r.json().user.id as string, email };
}
type U = Awaited<ReturnType<typeof login>>;
const call = async (u: U, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: unknown) => {
  const r = await app.inject({ method, url, headers: { authorization: `Bearer ${u.token}` }, payload: payload as object | undefined });
  return { status: r.statusCode, body: r.body ? (JSON.parse(r.body) as any) : null };
};
const file = async (u: U, name: string, parentId?: string) => (await call(u, "POST", "/v1/files", { name, scene: scene(), parentId })).body as { id: string };
const folder = async (u: U, name: string, parentId?: string) => (await call(u, "POST", "/v1/folders", { name, parentId })).body as { id: string };
const tag = async (u: U, name: string, color?: string) => (await call(u, "POST", "/v1/tags", { name, color })).body as { id: string };

beforeAll(async () => {
  db = await openMemory();
  await migrate(db);
  app = await buildApp(loadConfig({ JWT_SECRET: "t".repeat(40), DEV_AUTH: "1" }), db);
});
afterAll(async () => {
  await app.close();
  await db.close();
});

describe("tags", () => {
  it("creates, renames, recolours and deletes tags; names are unique per person", async () => {
    const u = await login("tg1@example.com");
    const t = await call(u, "POST", "/v1/tags", { name: "  Client work ", color: "blue" });
    expect(t.status).toBe(201);
    expect(t.body).toMatchObject({ name: "Client work", color: "blue", count: 0 });

    expect((await call(u, "POST", "/v1/tags", { name: "client WORK" })).status).toBe(409); // case-insensitive duplicate
    expect((await call(u, "POST", "/v1/tags", { name: "x", color: "pink" })).status).toBe(400);
    expect((await call(u, "POST", "/v1/tags", { name: "   " })).status).toBe(400);

    expect((await call(u, "PATCH", `/v1/tags/${t.body.id}`, { name: "Clients", color: "green" })).body).toMatchObject({ name: "Clients", color: "green" });
    const other = await tag(u, "Ideas");
    expect((await call(u, "PATCH", `/v1/tags/${other.id}`, { name: "clients" })).status).toBe(409);

    expect((await call(u, "GET", "/v1/tags")).body.tags.map((x: { name: string }) => x.name)).toEqual(["Clients", "Ideas"]);
    expect((await call(u, "DELETE", `/v1/tags/${other.id}`)).status).toBe(204);
    expect((await call(u, "DELETE", `/v1/tags/${other.id}`)).status).toBe(404);
  });

  it("tags files and folders, shows them in lists, and filters by tag across folders", async () => {
    const u = await login("tg2@example.com");
    const urgent = await tag(u, "Urgent", "red");
    const later = await tag(u, "Later", "gray");
    const top = await folder(u, "Projects");
    const a = await file(u, "In root");
    const b = await file(u, "Deep", top.id);
    const c = await file(u, "Untagged");

    expect((await call(u, "PUT", `/v1/files/${a.id}/tags`, { tagIds: [urgent.id, later.id] })).body.tags.map((x: { name: string }) => x.name)).toEqual(["Later", "Urgent"]);
    await call(u, "PUT", `/v1/files/${b.id}/tags`, { tagIds: [urgent.id] });
    await call(u, "PUT", `/v1/files/${top.id}/tags`, { tagIds: [later.id] });

    const root = (await call(u, "GET", "/v1/files?view=mine")).body.files as { name: string; tags: { name: string }[] }[];
    expect(root.find((f) => f.name === "In root")!.tags.map((x) => x.name)).toEqual(["Later", "Urgent"]);
    expect(root.find((f) => f.name === "Projects")!.tags.map((x) => x.name)).toEqual(["Later"]);
    expect(root.find((f) => f.name === "Untagged")!.tags).toEqual([]);
    expect((await call(u, "GET", `/v1/files/${c.id}`)).body.tags).toEqual([]);

    // filter: every item with the tag, wherever it lives
    const urgentItems = (await call(u, "GET", `/v1/files?tag=${urgent.id}`)).body.files.map((f: { name: string }) => f.name);
    expect(urgentItems.sort()).toEqual(["Deep", "In root"]);
    expect((await call(u, "GET", `/v1/files?tag=${later.id}`)).body.files.map((f: { name: string }) => f.name).sort()).toEqual(["In root", "Projects"]);

    // counts, then replacing and clearing
    expect((await call(u, "GET", "/v1/tags")).body.tags.map((t: { name: string; count: number }) => [t.name, t.count])).toEqual([["Later", 2], ["Urgent", 2]]);
    await call(u, "PUT", `/v1/files/${a.id}/tags`, { tagIds: [] });
    expect((await call(u, "GET", `/v1/files?tag=${urgent.id}`)).body.files.map((f: { name: string }) => f.name)).toEqual(["Deep"]);

    // deleting a tag removes it from everything
    await call(u, "DELETE", `/v1/tags/${urgent.id}`);
    expect((await call(u, "GET", `/v1/files/${b.id}`)).body.tags).toEqual([]);
  });

  it("keeps trashed items out of the filter and the counts, and hides them with their folder", async () => {
    const u = await login("tg3@example.com");
    const t = await tag(u, "Work");
    const top = await folder(u, "F");
    const inside = await file(u, "Inside", top.id);
    const loose = await file(u, "Loose");
    await call(u, "PUT", `/v1/files/${inside.id}/tags`, { tagIds: [t.id] });
    await call(u, "PUT", `/v1/files/${loose.id}/tags`, { tagIds: [t.id] });
    await call(u, "DELETE", `/v1/files/${loose.id}`);
    await call(u, "DELETE", `/v1/files/${top.id}`);
    expect((await call(u, "GET", `/v1/files?tag=${t.id}`)).body.files).toEqual([]);
    expect((await call(u, "GET", "/v1/tags")).body.tags[0].count).toBe(0);
    await call(u, "PATCH", `/v1/files/${top.id}`, { trashed: false });
    expect((await call(u, "GET", `/v1/files?tag=${t.id}`)).body.files.map((f: { name: string }) => f.name)).toEqual(["Inside"]);
  });

  it("tags are private: other people never see them, and cannot use yours", async () => {
    const owner = await login("tg4-owner@example.com");
    const guest = await login("tg4-guest@example.com");
    const stranger = await login("tg4-stranger@example.com");
    const doc = await file(owner, "Shared doc");
    await call(owner, "POST", `/v1/files/${doc.id}/shares`, { email: guest.email, role: "viewer" });
    const mine = await tag(owner, "Secret plan");
    const theirs = await tag(guest, "To read");

    await call(owner, "PUT", `/v1/files/${doc.id}/tags`, { tagIds: [mine.id] });
    // a viewer can tag what was shared with them, privately
    expect((await call(guest, "PUT", `/v1/files/${doc.id}/tags`, { tagIds: [theirs.id] })).status).toBe(200);

    expect((await call(guest, "GET", `/v1/files/${doc.id}`)).body.tags.map((x: { name: string }) => x.name)).toEqual(["To read"]);
    expect((await call(owner, "GET", `/v1/files/${doc.id}`)).body.tags.map((x: { name: string }) => x.name)).toEqual(["Secret plan"]);
    expect((await call(guest, "GET", `/v1/files?view=shared`)).body.files[0].tags.map((x: { name: string }) => x.name)).toEqual(["To read"]);
    expect((await call(guest, "GET", `/v1/files?tag=${theirs.id}`)).body.files.map((f: { name: string }) => f.name)).toEqual(["Shared doc"]);

    // using someone else's tag, or filtering by it, is refused
    expect((await call(guest, "PUT", `/v1/files/${doc.id}/tags`, { tagIds: [mine.id] })).status).toBe(400);
    expect((await call(guest, "GET", `/v1/files?tag=${mine.id}`)).status).toBe(404);
    expect((await call(guest, "PATCH", `/v1/tags/${mine.id}`, { name: "x" })).status).toBe(404);
    expect((await call(guest, "DELETE", `/v1/tags/${mine.id}`)).status).toBe(404);
    // and a stranger cannot tag what they cannot read
    const strangerTag = await tag(stranger, "Mine");
    expect((await call(stranger, "PUT", `/v1/files/${doc.id}/tags`, { tagIds: [strangerTag.id] })).status).toBe(404);

    // losing access removes the item from the tag filter
    const share = (await call(owner, "GET", `/v1/files/${doc.id}/shares`)).body.shares[0];
    await call(owner, "DELETE", `/v1/files/${doc.id}/shares/${share.id}`);
    expect((await call(guest, "GET", `/v1/files?tag=${theirs.id}`)).body.files).toEqual([]);
  });

  it("limits tags per person", async () => {
    const u = await login("tg5@example.com");
    for (let i = 0; i < 50; i++) expect((await call(u, "POST", "/v1/tags", { name: `t${i}` })).status).toBe(201);
    expect((await call(u, "POST", "/v1/tags", { name: "one too many" })).status).toBe(400);
  });
});
