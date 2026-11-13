import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z, ZodError } from "zod";
import { API_VERSION, GoogleAuthBody, MAX_SCENE_BYTES, MIN_EXTENSION_VERSION, RefreshBody } from "@ecd/shared";
import { AuthError, exchangeCode } from "./auth/google.js";
import { DataCrypto } from "./crypto.js";
import { createSession, revokeSession, rotateSession, signAccessToken, verifyAccessToken } from "./auth/tokens.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { registerFileRoutes } from "./files.js";
import { HttpError, parse } from "./http.js";
import type { Mailer } from "./mailer.js";
import { registerLinkPage } from "./linkpage.js";
import type { AuthUser } from "./permissions.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function buildApp(cfg: Config, db: Db, mailer: Mailer | null = null): Promise<FastifyInstance> {
  const crypt = new DataCrypto(cfg.dataKeys);

  const app = Fastify({ logger: process.env.NODE_ENV !== "test", bodyLimit: MAX_SCENE_BYTES + 1024 * 1024, trustProxy: true });

  await app.register(cors, {
    origin: cfg.corsOrigins.length ? cfg.corsOrigins : cfg.DEV_AUTH === "1",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["authorization", "content-type", "if-match"],
    exposedHeaders: ["etag"],
  });
  await app.register(rateLimit, { max: process.env.NODE_ENV === "test" ? 100000 : 300, timeWindow: "1 minute" });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, ...err.extra });
    if (err instanceof ZodError) return reply.status(400).send({ error: "invalid_request" });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: "bad_request", message: e.message });
    app.log.error(err);
    return reply.status(500).send({ error: "internal_error" });
  });

  const audit = (userId: string | null, action: string, target?: string) =>
    db.query(`INSERT INTO audit_log (user_id, action, target) VALUES ($1, $2, $3)`, [userId, action, target ?? null]);

  const issue = async (user: AuthUser, refreshToken: string) => {
    const { token, expiresIn } = await signAccessToken(cfg.JWT_SECRET, user.id);
    return { accessToken: token, accessExpiresIn: expiresIn, refreshToken, user };
  };

  const upsertUser = async (p: { sub: string; email: string; name: string; picture: string | null }): Promise<AuthUser> => {
    const rows = await db.query<AuthUser>(
      `INSERT INTO users (google_sub, email, name, avatar) VALUES ($1, $2, $3, $4)
       ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, avatar = EXCLUDED.avatar
       RETURNING id, email, name, avatar`,
      [p.sub, p.email, p.name, p.picture],
    );
    return rows[0]!;
  };

  // ---------- public routes ----------
  app.get("/health", async (_req, reply) => {
    try {
      await db.query("SELECT 1");
      return { ok: true };
    } catch {
      return reply.status(503).send({ ok: false });
    }
  });

  app.get("/v1/meta", async () => ({
    apiVersion: API_VERSION,
    minExtensionVersion: MIN_EXTENSION_VERSION,
    googleClientId: cfg.GOOGLE_CLIENT_ID,
  }));

  const authLimit = { config: { rateLimit: { max: process.env.NODE_ENV === "test" ? 100000 : 20, timeWindow: "1 minute" } } };

  app.post("/v1/auth/google", authLimit, async (req) => {
    const body = parse(GoogleAuthBody, req.body);
    let profile;
    try {
      profile = await exchangeCode(cfg, body);
    } catch (e) {
      throw new HttpError(401, e instanceof AuthError ? e.message : "google_verification_failed");
    }
    const user = await upsertUser(profile);
    await audit(user.id, "login");
    return issue(user, await createSession(db, user.id));
  });

  if (cfg.DEV_AUTH === "1") {
    app.post("/v1/auth/dev", async (req) => {
      const body = parse(z.object({ email: z.string().email(), name: z.string().default("Dev User") }), req.body);
      const user = await upsertUser({ sub: `dev:${body.email.toLowerCase()}`, email: body.email.toLowerCase(), name: body.name, picture: null });
      return issue(user, await createSession(db, user.id));
    });
  }

  app.post("/v1/auth/refresh", authLimit, async (req) => {
    const { refreshToken } = parse(RefreshBody, req.body);
    const rotated = await rotateSession(db, refreshToken);
    if (!rotated) throw new HttpError(401, "invalid_refresh_token");
    const rows = await db.query<AuthUser>(`SELECT id, email, name, avatar FROM users WHERE id = $1`, [rotated.userId]);
    if (!rows[0]) throw new HttpError(401, "invalid_refresh_token");
    return issue(rows[0], rotated.refreshToken);
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const { refreshToken } = parse(RefreshBody, req.body);
    await revokeSession(db, refreshToken);
    return reply.status(204).send();
  });

  // ---------- authenticated routes ----------
  await app.register(async (api) => {
    api.addHook("preHandler", async (req: FastifyRequest) => {
      const h = req.headers.authorization;
      const token = h?.startsWith("Bearer ") ? h.slice(7) : null;
      const userId = token ? await verifyAccessToken(cfg.JWT_SECRET, token) : null;
      if (!userId) throw new HttpError(401, "unauthorized");
      const rows = await db.query<AuthUser>(`SELECT id, email, name, avatar FROM users WHERE id = $1`, [userId]);
      if (!rows[0]) throw new HttpError(401, "unauthorized");
      req.user = rows[0];
    });

    registerFileRoutes(api, { db, cfg, crypt, mailer });
  });

  registerLinkPage(app);

  return app;
}
