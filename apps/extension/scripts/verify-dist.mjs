// Sanity-checks the BUILT extension (dist/) the way Chrome and a reviewer would.
// Run after a build:  npm run verify --workspace @ecd/extension   (also part of `npm run check`)
import { access, readFile } from "node:fs/promises";
import { extensionIdFromPublicKey } from "./extension-id.mjs";

const dist = new URL("../dist/", import.meta.url);
const problems = [];
const bad = (msg) => problems.push(msg);

const read = (rel) => readFile(new URL(rel, dist), "utf8");
const exists = async (rel, why) => {
  try {
    await access(new URL(rel, dist));
  } catch {
    bad(`missing file ${rel} (${why})`);
  }
};

const manifest = JSON.parse(await read("manifest.json"));
const brand = JSON.parse(await readFile(new URL("../../../brand/brand.json", import.meta.url), "utf8"));

// ---- basics ----
if (manifest.manifest_version !== 3) bad("manifest_version must be 3");
if (manifest.name !== brand.store_name) bad(`name is "${manifest.name}", expected "${brand.store_name}" from brand/brand.json`);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) bad(`version "${manifest.version}" is not x.y.z`);

// ---- every file the manifest points at must exist ----
await exists(manifest.background?.service_worker, "service worker");
await exists(manifest.side_panel?.default_path, "side panel page");
for (const f of Object.values(manifest.icons ?? {})) await exists(f, "icon");
for (const f of Object.values(manifest.action?.default_icon ?? {})) await exists(f, "toolbar icon");
for (const cs of manifest.content_scripts ?? []) for (const f of cs.js ?? []) await exists(f, "content script");
if (!manifest.icons || Object.keys(manifest.icons).length < 4) bad("expected icons at 16, 32, 48 and 128");

// ---- permissions: least privilege, nothing broad ----
const ALLOWED = new Set(["storage", "identity", "sidePanel", "alarms"]);
for (const p of manifest.permissions ?? []) if (!ALLOWED.has(p)) bad(`unexpected permission "${p}" (allowed: ${[...ALLOWED].join(", ")})`);
const hosts = manifest.host_permissions ?? [];
for (const h of hosts) if (/<all_urls>|^\*:\/\/\*\/|^https?:\/\/\*\//.test(h)) bad(`host permission too broad: ${h}`);
if (!hosts.includes("https://excalidraw.com/*")) bad("host_permissions must include https://excalidraw.com/*");
const apiHosts = hosts.filter((h) => h !== "https://excalidraw.com/*");
if (apiHosts.length !== 1) bad(`expected exactly one API host permission, found ${apiHosts.length}: ${apiHosts.join(", ")}`);
const apiOrigin = (apiHosts[0] ?? "").replace(/\/\*$/, "");

// ---- content scripts only run where we mean them to ----
for (const cs of manifest.content_scripts ?? []) {
  for (const m of cs.matches ?? []) {
    const ok = m === "https://excalidraw.com/*" || (apiOrigin && m === `${apiOrigin}/s/*`);
    if (!ok) bad(`content script matches an unexpected page: ${m}`);
  }
}

// ---- the panel page loads only local files ----
const html = await read(manifest.side_panel?.default_path ?? "sidepanel.html");
for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const ref = m[1];
  if (/^https?:|^\/\//.test(ref)) bad(`sidepanel.html loads a remote file: ${ref}`);
  else await exists(ref, "referenced by sidepanel.html");
}
for (const m of html.matchAll(/url\("([^"]+)"\)/g)) if (!/^https?:|^data:/.test(m[1])) await exists(m[1], "font referenced by sidepanel.html");

// ---- every bundled asset the panel code refers to must be shipped ----
const panelJs = await read("sidepanel.js");
for (const ref of new Set([...panelJs.matchAll(/["'`](assets\/[A-Za-z0-9_./-]+\.(?:png|svg|woff2))["'`]/g)].map((m) => m[1]))) await exists(ref, "referenced by sidepanel.js");

// ---- a build for a real server must not contain the dev sign-in ----
const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(apiOrigin);
const code = (await read("sidepanel.js")) + (await read("background.js"));
// markers of the dev-only form and the dev-only endpoint (not the generic error text)
const hasDevLogin = code.includes("local testing only") || code.includes("/v1/auth/dev");
if (!isLocal && hasDevLogin) bad(`this build points at ${apiOrigin} but contains the dev sign-in code`);

// ---- no secrets baked in ----
if (/GOOGLE_CLIENT_SECRET|client_secret\s*[:=]\s*["'][^"']{6,}/.test(code)) bad("built code mentions a client secret");

// ---- the pinned id, if any (a bad key would silently change the id and break sign-in) ----
let idNote = "extension id not pinned";
if (manifest.key) {
  try {
    idNote = `extension id ${extensionIdFromPublicKey(manifest.key)} (pinned)`;
  } catch {
    bad("manifest.key is not a valid public key");
  }
}

console.log(
  problems.length
    ? `verify-dist: ${problems.length} problem(s)\n - ${problems.join("\n - ")}`
    : `verify-dist: ok (API ${apiOrigin}${isLocal ? ", local dev build" : ""}, ${idNote}, ${manifest.permissions.length} permissions, ${manifest.content_scripts.length} content scripts)`,
);
process.exit(problems.length ? 1 : 0);
