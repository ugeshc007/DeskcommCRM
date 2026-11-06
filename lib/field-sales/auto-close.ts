import type pg from 'pg';
/** Old schedulers may still call this endpoint. It must never end a person's shift. */
export async function closeExpiredFieldSessions(_pool: Pick<pg.Pool, 'connect'>) {
  return { closed: 0 };
}
