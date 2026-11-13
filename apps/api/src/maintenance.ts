import type { Db } from "./db.js";

/**
 * Housekeeping that keeps tables from growing forever. Safe to run at any time, as often as you like.
 *  - sessions: expired ones go after 7 days; revoked ones are kept 30 days so a stolen, already-used
 *    refresh token is still recognised (and its whole family revoked) for a month.
 *  - audit_log: kept 180 days.
 */
export async function runMaintenance(db: Db): Promise<{ sessions: number; audit: number }> {
  const s = await db.query(
    `DELETE FROM sessions
      WHERE expires_at < now() - interval '7 days'
         OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')
      RETURNING id`,
  );
  const a = await db.query(`DELETE FROM audit_log WHERE at < now() - interval '180 days' RETURNING id`);
  return { sessions: s.length, audit: a.length };
}
