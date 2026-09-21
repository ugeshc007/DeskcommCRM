import type pg from 'pg';
import { fieldAudit } from './authority';

/** Bounded, server-authoritative cutoff. The phone also stops GPS locally at 14h. */
export async function closeExpiredFieldSessions(pool: Pick<pg.Pool, 'connect'>) {
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query("set local lock_timeout='5s'");
    const installed = (await db.query("select to_regclass('public.field_sales_sessions') as name")).rows[0]?.name;
    if (!installed) { await db.query('commit'); return { closed: 0 }; }
    const due = await db.query(`select organization_id,id,employee_id,punched_in_at from public.field_sales_sessions
      where punched_out_at is null and punched_in_at + interval '14 hours' <= clock_timestamp()
      order by punched_in_at limit 100 for update skip locked`);
    for (const row of due.rows) {
      const cutoff = new Date((row.punched_in_at as Date).getTime() + 14 * 3600000);
      await db.query(`update public.field_sales_sessions set status='off_duty',punched_out_at=$3
        where organization_id=$1 and id=$2 and punched_out_at is null`, [row.organization_id, row.id, cutoff]);
      await db.query(`delete from public.field_sales_locations where organization_id=$1 and session_id=$2 and captured_at >= $3`,
        [row.organization_id, row.id, cutoff]);
      await fieldAudit(db, row.organization_id, row.employee_id, 'field_sales.auto_punch_out', row.id,
        { max_hours: 14 });
    }
    await db.query('commit');
    return { closed: due.rowCount ?? 0 };
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
}
