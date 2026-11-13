import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { migrate, openMemory, openPg } from "./db.js";
import { runMaintenance } from "./maintenance.js";

const cfg = loadConfig();
const db = cfg.DATABASE_URL ? await openPg(cfg.DATABASE_URL) : await openMemory();
if (!cfg.DATABASE_URL) console.warn("DATABASE_URL not set: using in-memory database (data is lost on restart).");

const applied = await migrate(db);
if (applied.length) console.log("applied migrations:", applied.join(", "));

const app = await buildApp(cfg, db);
await app.listen({ port: cfg.PORT, host: cfg.HOST });

// Housekeeping at start and every 6 hours. A failure here must never take the API down.
const maintain = () =>
  runMaintenance(db).then(
    (r) => (r.sessions || r.audit) && app.log.info(r, "maintenance removed old rows"),
    (e) => app.log.error(e, "maintenance failed"),
  );
void maintain();
const timer = setInterval(() => void maintain(), 6 * 3600_000);
timer.unref();

const shutdown = async () => {
  clearInterval(timer);
  await app.close();
  await db.close();
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// Log and keep serving rather than dying on a stray rejection from one request.
process.on("unhandledRejection", (e) => app.log.error(e, "unhandled rejection"));
