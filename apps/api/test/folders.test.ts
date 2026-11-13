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

  it("moves items, refuses loops, and only owners may move", async () => {
    const owner = await login("mv-owner@example.com");
    const editor = await login("mv-editor@example.com");
    const top = await folder(owner, "Top");
    const sub = await folder(owner, "Sub", top.id);
    const f = await file(owner, "Doc");

    expect((await call(owner, "PATCH", `/v1/files/${f.id}`, { parentId: sub.id })).status).toBe(200);
    expect((await call(owner, "GET", `/v1/files?parent=${sub.id}`)).body.files.map((x: { id: string }) => x.id)).toContain(f.id);
    expect((await call(owner, "PATCH", `/v1/files/${top.id}`, { parentId: sub.id })).status).toBe(400); // into own child
    expect((await call(owner, "PATCH", `/v1/files/${top.id}`, { parentId: top.id })).status).toBe(400); // into itself
    expect((await call(owner, "PATCH", `/v1/files/${f.id}`, { parentId: null })).status).toBe(200); // back to root

    await call(owner, "POST", `/v1/files/${top.id}/shares`, { email: editor.email, role: "editor" });
    const inTop = await file(owner, "In top", top.id);
    expect((await call(editor, "PATCH", `/v1/files/${inTop.id}`, { parentId: null })).status).toBe(404); // editors cannot move
  });
});

describe("sharing a folder (inherited access, like Google Drive)", () => {
  it("flows down to everything inside, with the right role", async () => {
    const owner = await login("sh-owner@example.com", "Pari");
    const editor = await login("sh-editor@example.com");
    const viewer = await login("sh-viewer@example.com");
    const stranger = await login("sh-stranger@example.com");
    const top = await folder(owner, "Team");
    const sub = await folder(owner, "Deep", top.id);
    const doc = await file(owner, "Doc", sub.id);
    await call(owner, "POST", `/v1/files/${top.id}/shares`, { email: editor.email, role: "editor" });
    await call(owner, "POST", `/v1/files/${top.id}/shares`, { email: viewer.email, role: "viewer" });

    // both can read, two levels down
    expect((await call(editor, "GET", `/v1/files/${doc.id}`)).status).toBe(200);
    expect((await call(viewer, "GET", `/v1/files/${doc.id}`)).status).toBe(200);
    // editor can save, viewer cannot
    expect((await call(editor, "PUT", `/v1/files/${doc.id}`, { scene: scene(2) }, { "if-match": "1" })).status).toBe(200);
    expect((await call(viewer, "PUT", `/v1/files/${doc.id}`, { scene: scene(2) }, { "if-match": "2" })).status).toBe(404);
    // strangers see nothing
    expect((await call(stranger, "GET", `/v1/files/${doc.id}`)).status).toBe(404);
    expect((await call(stranger, "GET", `/v1/files?parent=${top.id}`)).status).toBe(404);

    // listing a folder reports the caller's inherited access
    const list = await call(viewer, "GET", `/v1/files?parent=${top.id}`);
    expect(list.body.files[0].access).toBe("viewer");
    expect((await call(editor, "GET", `/v1/files?parent=${sub.id}`)).body.files[0].access).toBe("editor");

    // "Shared with me" shows the shared folder only, not what is inside it
    const shared = await call(viewer, "GET", "/v1/files?view=shared");
    expect(names(shared as any)).toEqual(["Team"]);

    // breadcrumb starts at the shared folder for the invitee
    const path = await call(viewer, "GET", `/v1/files/${doc.id}/path`);
    expect(path.body.path.map((p: { name: string }) => p.name)).toEqual(["Team", "Deep", "Doc"]);

    // a stronger direct share on a child upgrades the inherited role
    await call(owner, "POST", `/v1/files/${doc.id}/shares`, { email: viewer.email, role: "editor" });
    expect((await call(viewer, "PUT", `/v1/files/${doc.id}`, { scene: scene(3) }, { "if-match": "2" })).status).toBe(200);

    // recent includes files reachable through the shared folder
    const recent = await call(editor, "GET", "/v1/files?view=recent");
    expect(names(recent as any)).toContain("Doc");
  });

  it("new items an editor creates in a shared folder belong to the folder's owner", async () => {
    const owner = await login("own2@example.com");
    const editor = await login("ed2@example.com");
    const top = await folder(owner, "Shared drive");
    await call(owner, "POST", `/v1/files/${top.id}/shares`, { email: editor.email, role: "editor" });
    const made = await call(editor, "POST", "/v1/files", { name: "By editor", scene: scene(), parentId: top.id });
    expect(made.status).toBe(201);
    expect(made.body.ownerId).toBe(owner.id);
    // the owner can see and manage it; a viewer cannot create there
    expect((await call(owner, "GET", `/v1/files/${made.body.id}`)).body.access).toBe("owner");
    const viewer = await login("vw2@example.com");
    await call(owner, "POST", `/v1/files/${top.id}/shares`, { email: viewer.email, role: "viewer" });
    expect((await call(viewer, "POST", "/v1/files", { name: "Nope", scene: scene(), parentId: top.id })).status).toBe(400);
  });

  it("shows inherited people and changes roles in the share dialog data", async () => {
    const owner = await login("dlg-owner@example.com", "Pari");
    const a = await login("dlg-a@example.com");
    const top = await folder(owner, "Top");
    const doc = await file(owner, "Doc", top.id);
    const s = await call(owner, "POST", `/v1/files/${top.id}/shares`, { email: a.email, role: "viewer" });

    const info = (await call(owner, "GET", `/v1/files/${doc.id}/shares`)).body;
    expect(info.owner).toEqual({ name: "Pari", email: "dlg-owner@example.com" });
    expect(info.shares).toHaveLength(0);
    expect(info.inherited).toMatchObject([{ email: a.email, role: "viewer", fromName: "Top" }]);
    expect(info.link).toEqual({ enabled: false, role: "viewer", token: null });

    expect((await call(owner, "PATCH", `/v1/files/${top.id}/shares/${s.body.id}`, { role: "editor" })).status).toBe(200);
    expect((await call(a, "PUT", `/v1/files/${doc.id}`, { scene: scene(2) }, { "if-match": "1" })).status).toBe(200);
  });

  it("lets someone leave what was shared with them", async () => {
    const owner = await login("lv-owner@example.com");
    const guest = await login("lv-guest@example.com");
    const doc = await file(owner, "Leaving");
    await call(owner, "POST", `/v1/files/${doc.id}/shares`, { email: guest.email, role: "viewer" });
    expect((await call(guest, "GET", "/v1/files?view=shared")).body.files).toHaveLength(1);
    expect((await call(guest, "POST", `/v1/files/${doc.id}/leave`)).status).toBe(204);
    expect((await call(guest, "GET", "/v1/files?view=shared")).body.files).toHaveLength(0);
    expect((await call(owner, "POST", `/v1/files/${doc.id}/leave`)).status).toBe(400);
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

describe("anyone with the link", () => {
  it("grants access only after a signed-in person redeems the link, and revoking cuts it off", async () => {
    const owner = await login("lk-owner@example.com");
    const guest = await login("lk-guest@example.com");
    const doc = await file(owner, "Linked");

    const on = await call(owner, "PUT", `/v1/files/${doc.id}/link`, { enabled: true, role: "viewer" });
    expect(on.status).toBe(200);
    const token = on.body.token as string;
    expect(token.length).toBeGreaterThan(30);

    expect((await call(guest, "GET", `/v1/files/${doc.id}`)).status).toBe(404); // knowing the id is not enough
    expect((await call(guest, "POST", "/v1/links/not-a-real-token-not-a-real-token/redeem")).status).toBe(404);

    const redeemed = await call(guest, "POST", `/v1/links/${token}/redeem`);
    expect(redeemed.body).toMatchObject({ id: doc.id, name: "Linked", kind: "file", access: "viewer" });
    expect((await call(guest, "GET", `/v1/files/${doc.id}`)).status).toBe(200);
    expect((await call(guest, "PUT", `/v1/files/${doc.id}`, { scene: scene(2) }, { "if-match": "1" })).status).toBe(404);
    expect(names((await call(guest, "GET", "/v1/files?view=shared")) as any)).toEqual(["Linked"]);

    // the owner sees the same link again, and can upgrade it to editor
    expect((await call(owner, "GET", `/v1/files/${doc.id}/shares`)).body.link).toEqual({ enabled: true, role: "viewer", token });
    await call(owner, "PUT", `/v1/files/${doc.id}/link`, { enabled: true, role: "editor" });
    expect((await call(guest, "PUT", `/v1/files/${doc.id}`, { scene: scene(2) }, { "if-match": "1" })).status).toBe(200);

    // turning it off removes access at once, and turning it on again needs a fresh redeem
    await call(owner, "PUT", `/v1/files/${doc.id}/link`, { enabled: false });
    expect((await call(guest, "GET", `/v1/files/${doc.id}`)).status).toBe(404);
    expect((await call(guest, "POST", `/v1/links/${token}/redeem`)).status).toBe(404);
    const again = await call(owner, "PUT", `/v1/files/${doc.id}/link`, { enabled: true });
    expect(again.body.token).toBe(token);
    expect((await call(guest, "GET", `/v1/files/${doc.id}`)).status).toBe(404);
    expect((await call(guest, "POST", `/v1/links/${token}/redeem`)).status).toBe(200);
  });

  it("works on folders and flows down to the contents", async () => {
    const owner = await login("lkf-owner@example.com");
    const guest = await login("lkf-guest@example.com");
    const top = await folder(owner, "Public-ish");
    const doc = await file(owner, "Inside", top.id);
    const token = (await call(owner, "PUT", `/v1/files/${top.id}/link`, { enabled: true })).body.token as string;
    expect((await call(guest, "POST", `/v1/links/${token}/redeem`)).body.kind).toBe("folder");
    expect((await call(guest, "GET", `/v1/files/${doc.id}`)).status).toBe(200);
  });

  it("only the owner can manage the link, and the token is never stored in the clear", async () => {
    const owner = await login("lkm-owner@example.com");
    const editor = await login("lkm-editor@example.com");
    const doc = await file(owner, "Doc");
    await call(owner, "POST", `/v1/files/${doc.id}/shares`, { email: editor.email, role: "editor" });
    expect((await call(editor, "PUT", `/v1/files/${doc.id}/link`, { enabled: true })).status).toBe(404);
    const token = (await call(owner, "PUT", `/v1/files/${doc.id}/link`, { enabled: true })).body.token as string;
    const row = (await db.query<{ token_hash: string; token_enc: Uint8Array }>(`SELECT token_hash, token_enc FROM link_shares WHERE file_id = $1`, [doc.id]))[0]!;
    expect(row.token_hash).not.toContain(token);
    expect(Buffer.from(row.token_enc).includes(Buffer.from(token))).toBe(false);
  });

  it("serves a harmless landing page", async () => {
    const r = await app.inject({ method: "GET", url: "/s/anything-at-all" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("text/html");
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.body).toContain("Open in Inkdrive");
  });
});
