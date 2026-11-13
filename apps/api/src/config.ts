import { z } from "zod";
import { generateDataKey } from "./crypto.js";

const Env = z.object({
  PORT: z.coerce.number().default(8787),
  HOST: z.string().default("0.0.0.0"),
  /** postgres://... ; when unset the server uses an in-memory PGlite (dev only). */
  DATABASE_URL: z.string().optional(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  GOOGLE_CLIENT_ID: z.string().default(""),
  GOOGLE_CLIENT_SECRET: z.string().default(""),
  /** Redirect URIs we accept, comma-separated, e.g. https://<extid>.chromiumapp.org/ */
  ALLOWED_REDIRECT_URIS: z.string().default(""),
  /** Origins allowed to call the API, comma-separated (chrome-extension://<id>). */
  CORS_ORIGINS: z.string().default(""),
  /** Dev only: enables POST /v1/auth/dev so you can test without Google. */
  DEV_AUTH: z.enum(["0", "1"]).default("0"),
  /** base64 of 32 random bytes; encrypts drawings at rest. Required with a real database. */
  DATA_KEY: z.string().optional(),
  /** Previous keys (comma-separated base64) kept only so old data can still be decrypted after rotation. */
  DATA_KEY_OLD: z.string().default(""),
  PER_USER_QUOTA_BYTES: z.coerce.number().default(500 * 1024 * 1024),
  KEEP_VERSIONS: z.coerce.number().default(20),
});

export type Config = z.infer<typeof Env> & {
  allowedRedirects: string[];
  corsOrigins: string[];
  /** Current key first, then old ones. */
  dataKeys: string[];
};

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const c = Env.parse(env);
  if (c.DEV_AUTH === "1" && c.DATABASE_URL) {
    throw new Error("DEV_AUTH=1 is not allowed together with a real DATABASE_URL");
  }
  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean);
  let current = c.DATA_KEY;
  if (!current) {
    // A throwaway key is fine for the in-memory dev database (it vanishes on restart anyway).
    // With a real database it would make every stored drawing unreadable after a restart.
    if (c.DATABASE_URL) throw new Error("DATA_KEY is required with DATABASE_URL. Generate one with: openssl rand -base64 32 (and back it up: without it drawings cannot be read)");
    current = generateDataKey();
  }
  return {
    ...c,
    allowedRedirects: list(c.ALLOWED_REDIRECT_URIS),
    corsOrigins: list(c.CORS_ORIGINS),
    dataKeys: [current, ...list(c.DATA_KEY_OLD)],
  };
}
