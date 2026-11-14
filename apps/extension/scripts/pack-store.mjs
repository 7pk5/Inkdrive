// Builds the zip you upload to the Chrome Web Store.
//   API_URL=https://api.yourdomain.com npm run pack:store --workspace @ecd/extension
// The store assigns its own extension id, so this build deliberately has NO pinned key, and no dev sign-in.
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, statSync } from "node:fs";

const api = process.env.API_URL ?? "";
if (!/^https:\/\/[^/\s]+$/.test(api)) {
  console.error("Set API_URL to your server's https address, with no path. Example:\n  API_URL=https://api.example.com npm run pack:store --workspace @ecd/extension");
  process.exit(1);
}
const env = { ...process.env, NO_PIN: "1" };
delete env.DEV_LOGIN;
delete env.PIN_ID;

execFileSync("node", ["build.mjs"], { stdio: "inherit", env });
execFileSync("node", ["scripts/verify-dist.mjs"], { stdio: "inherit", env });

const manifest = JSON.parse(readFileSync("dist/manifest.json", "utf8"));
if (manifest.key) throw new Error("the store package must not contain a pinned key");
const out = `inkdrive-${manifest.version}.zip`;
rmSync(out, { force: true });
// manifest.json must sit at the TOP of the zip (not inside a folder). Source maps are left out.
execFileSync("zip", ["-qrD", `../${out}`, ".", "-x", "*.map"], { cwd: "dist" });
const kb = Math.round(statSync(out).size / 1024);
console.log(`\nReady: apps/extension/${out} (${kb} KB). Upload this file in the Chrome Web Store dashboard.`);
