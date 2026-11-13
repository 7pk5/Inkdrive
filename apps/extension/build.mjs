// Bundles every extension entry with esbuild and copies static files into dist/.
// API_URL=https://api.example.com node build.mjs
import { build, context } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

const API_URL = (process.env.API_URL ?? "http://localhost:8787").replace(/\/$/, "");
const watch = process.argv.includes("--watch");

// Dev sign-in skips Google. It only works against an API started with DEV_AUTH=1, and we
// refuse to bake it into any build that points at a non-local API.
const DEV_LOGIN = process.env.DEV_LOGIN === "1";
const apiHost = new URL(API_URL).hostname;
if (DEV_LOGIN && !["localhost", "127.0.0.1", "[::1]"].includes(apiHost)) {
  throw new Error(`DEV_LOGIN=1 is only allowed with a localhost API_URL (got ${API_URL})`);
}

await mkdir("dist", { recursive: true });

const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
const apiOrigin = new URL(API_URL).origin + "/*";
manifest.host_permissions = ["https://excalidraw.com/*", apiOrigin];
// Name and description come from brand/brand.json so there is one place to rename the product.
const brand = JSON.parse(await readFile("../../brand/brand.json", "utf8"));
// The share-link landing page lives on our API origin, so its content script is added here.
manifest.content_scripts.push({ matches: [`${new URL(API_URL).origin}/s/*`], js: ["linkpage.js"], run_at: "document_idle" });
manifest.name = brand.store_name;
// A pinned public key (npm run pin-id) gives the extension the same id on every machine and build, which Google sign-in
// and the server's CORS setting depend on. It is applied to builds for a real server. Local dev builds keep their own
// path-based id (so your loaded dev copy keeps working) unless you ask: PIN_ID=1 npm run build:ext
const isLocalApi = ["localhost", "127.0.0.1", "[::1]"].includes(apiHost);
if ((!isLocalApi || process.env.PIN_ID === "1") && process.env.NO_PIN !== "1") {
  try {
    manifest.key = (await readFile(".extension-key.pub", "utf8")).trim();
  } catch {
    if (!isLocalApi) console.warn("WARNING: building for a real server without a pinned extension id. Run `npm run pin-id` first, or sign-in and CORS will break when the id changes.");
  }
}
await cp("icons", "dist/icons", { recursive: true });
await cp("assets", "dist/assets", { recursive: true });
await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2));
await cp("src/sidepanel/sidepanel.html", "dist/sidepanel.html");

const common = {
  bundle: true,
  target: "chrome120",
  sourcemap: true,
  // Folds `if (false)` / `false && x` so code behind build-time flags (the dev sign-in) is removed, not just disabled.
  minifySyntax: true,
  define: { __API_URL__: JSON.stringify(API_URL), __DEV_LOGIN__: JSON.stringify(DEV_LOGIN) },
  logLevel: "info",
};

const configs = [
  // Content scripts and the page-world hook must be classic scripts (IIFE).
  { ...common, format: "iife", entryPoints: { content: "src/content/index.ts", hook: "src/content/hook.ts", linkpage: "src/content/linkpage.ts" }, outdir: "dist" },
  { ...common, format: "esm", entryPoints: { background: "src/background/index.ts" }, outdir: "dist" },
  {
    ...common,
    format: "iife",
    entryPoints: { sidepanel: "src/sidepanel/index.tsx" },
    outdir: "dist",
    jsx: "automatic",
    define: { ...common.define, "process.env.NODE_ENV": '"production"' },
  },
];

if (watch) {
  for (const c of configs) await (await context(c)).watch();
  console.log("watching…");
} else {
  for (const c of configs) await build(c);
  console.log(`built → dist/ (API: ${API_URL})`);
}
