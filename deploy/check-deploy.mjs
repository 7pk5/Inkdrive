// Guards the deployment setup so a later edit cannot quietly weaken it.   npm run check:deploy
// Optional argument: a different compose file to check (used to prove the check catches problems).
import { readFile, stat } from "node:fs/promises";
import { parse } from "yaml";

const dir = new URL("./", import.meta.url);
const composePath = process.argv[2] ? new URL(process.argv[2], `file://${process.cwd()}/`) : new URL("docker-compose.yml", dir);
const problems = [];
const bad = (m) => problems.push(m);

const raw = await readFile(composePath, "utf8");
const compose = parse(raw);
const svc = compose.services ?? {};
for (const name of ["db", "api", "caddy", "backup"]) if (!svc[name]) bad(`service "${name}" is missing`);

// ---- only the proxy is reachable from outside ----
for (const [name, s] of Object.entries(svc)) {
  if (name !== "caddy" && s.ports?.length) bad(`${name} publishes ports ${JSON.stringify(s.ports)}; only caddy may`);
}
const caddyPorts = (svc.caddy?.ports ?? []).map(String).join(",");
if (!/80:80/.test(caddyPorts) || !/443:443/.test(caddyPorts)) bad("caddy must publish 80 and 443");

// ---- the database has no route to the internet ----
if (compose.networks?.internal?.internal !== true) bad('network "internal" must be `internal: true`');
for (const name of ["db", "backup"]) {
  const nets = svc[name]?.networks ?? [];
  if (nets.length !== 1 || nets[0] !== "internal") bad(`${name} must be on the internal network only (found ${JSON.stringify(nets)})`);
}
if (!(svc.api?.networks ?? []).includes("internal")) bad("api must reach the database over the internal network");

// ---- container hardening ----
for (const [name, s] of Object.entries(svc)) {
  if (!(s.security_opt ?? []).includes("no-new-privileges:true")) bad(`${name}: missing security_opt no-new-privileges:true`);
}
for (const name of ["api", "caddy"]) {
  if (svc[name]?.read_only !== true) bad(`${name} must run with read_only: true`);
  if (!(svc[name]?.cap_drop ?? []).includes("ALL")) bad(`${name} must drop all capabilities (cap_drop: [ALL])`);
}
if (String(svc.api?.environment?.DEV_AUTH) !== "0") bad('api must have DEV_AUTH: "0"');
if (svc.api?.environment?.NODE_ENV !== "production") bad("api must run with NODE_ENV=production");

// ---- no secret values written into the compose file ----
for (const m of raw.matchAll(/^\s*([A-Z_]*(?:PASSWORD|SECRET|KEY)[A-Z_]*):\s*(.+)$/gm)) {
  const value = m[2].trim();
  if (value && !value.startsWith("${") && value !== '""' && !/^["']?\$\{/.test(value)) bad(`${m[1]} has a literal value in docker-compose.yml`);
}

// ---- every required variable is produced by the generator and documented ----
const required = [...raw.matchAll(/\$\{([A-Z_]+):\?/g)].map((m) => m[1]);
const generator = await readFile(new URL("gen-secrets.sh", dir), "utf8");
const generated = new Set([...generator.matchAll(/echo "([A-Z_]+)=/g)].map((m) => m[1]));
const example = await readFile(new URL(".env.example", dir), "utf8");
const documented = new Set([...example.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]));
for (const v of new Set(required)) {
  if (!generated.has(v)) bad(`${v} is required by docker-compose.yml but gen-secrets.sh does not write it`);
  if (!documented.has(v)) bad(`${v} is required by docker-compose.yml but missing from .env.example`);
}

// ---- proxy and scripts ----
const caddy = await readFile(new URL("Caddyfile", dir), "utf8");
for (const needle of ["Strict-Transport-Security", "X-Content-Type-Options", "request_body"]) {
  if (!caddy.includes(needle)) bad(`Caddyfile lacks ${needle}`);
}
for (const f of ["gen-secrets.sh", "bootstrap-host.sh", "backup/backup.sh"]) {
  const mode = (await stat(new URL(f, dir))).mode;
  if (!(mode & 0o111)) bad(`${f} is not executable`);
}
const bootstrap = await readFile(new URL("bootstrap-host.sh", dir), "utf8");
for (const needle of ["PasswordAuthentication no", "ufw default deny incoming", "unattended-upgrades"]) {
  if (!bootstrap.includes(needle)) bad(`bootstrap-host.sh lacks "${needle}"`);
}

console.log(
  problems.length
    ? `check-deploy: ${problems.length} problem(s)\n - ${problems.join("\n - ")}`
    : `check-deploy: ok (${Object.keys(svc).length} services, ${new Set(required).size} required variables all generated and documented)`,
);
process.exit(problems.length ? 1 : 0);
