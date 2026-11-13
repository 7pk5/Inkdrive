import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { Db } from "../db.js";

const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 60;

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export async function signAccessToken(secret: string, userId: string): Promise<{ token: string; expiresIn: number }> {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL_SECONDS}s`)
    .setIssuer("ecd-api")
    .sign(new TextEncoder().encode(secret));
  return { token, expiresIn: ACCESS_TTL_SECONDS };
}

/** Returns the user id, or null if the token is missing/invalid/expired. */
export async function verifyAccessToken(secret: string, token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: "ecd-api",
      algorithms: ["HS256"],
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

const newRefreshToken = () => randomBytes(32).toString("base64url");
const expiry = () => new Date(Date.now() + REFRESH_TTL_DAYS * 86400_000).toISOString();

export async function createSession(db: Db, userId: string): Promise<string> {
  const token = newRefreshToken();
  await db.query(
    `INSERT INTO sessions (user_id, family_id, token_hash, expires_at) VALUES ($1, gen_random_uuid(), $2, $3)`,
    [userId, sha256(token), expiry()],
  );
  return token;
}

/**
 * Rotates a refresh token. Presenting an already-used token means it leaked:
 * the whole family is revoked and the caller must sign in again.
 */
export async function rotateSession(
  db: Db,
  presented: string,
): Promise<{ userId: string; refreshToken: string } | null> {
  const rows = await db.query<{ id: string; user_id: string; family_id: string; expires_at: string; revoked_at: string | null }>(
    `SELECT id, user_id, family_id, expires_at, revoked_at FROM sessions WHERE token_hash = $1`,
    [sha256(presented)],
  );
  const s = rows[0];
  if (!s) return null;
  if (s.revoked_at) {
    await db.query(`UPDATE sessions SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL`, [s.family_id]);
    return null;
  }
  if (new Date(s.expires_at) < new Date()) return null;
  const next = newRefreshToken();
  await db.tx(async (t) => {
    await t.query(`UPDATE sessions SET revoked_at = now() WHERE id = $1`, [s.id]);
    await t.query(`INSERT INTO sessions (user_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`, [
      s.user_id,
      s.family_id,
      sha256(next),
      expiry(),
    ]);
  });
  return { userId: s.user_id, refreshToken: next };
}

export async function revokeSession(db: Db, presented: string): Promise<void> {
  await db.query(
    `UPDATE sessions SET revoked_at = now() WHERE family_id = (SELECT family_id FROM sessions WHERE token_hash = $1) AND revoked_at IS NULL`,
    [sha256(presented)],
  );
}
