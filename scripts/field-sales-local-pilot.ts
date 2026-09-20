/** Explicit local pilot setup. Never accepts a remote database or creates a production credential. */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { issueFieldDevice } from '../lib/field-sales/devices';

async function main() {
  const api = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '');
  const dbUrl = new URL(process.env.SUPABASE_DB_URL ?? '');
  if (api.hostname !== '127.0.0.1' || api.port !== '55431' || dbUrl.hostname !== '127.0.0.1') throw new Error('local_pilot_only');
  dbUrl.port = '55432';
  const pool = new pg.Pool({ connectionString: dbUrl.toString() });
  const admin = createClient(api.toString(), process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  try {
    await pool.query(readFileSync('supabase/migrations/20260919030000_0317_field_sales_photos.sql', 'utf8'));
    await pool.query('select fn_provision_field_sales_photos()');
    const email = 'field-pilot@synthetic.test';
    let actor = (await pool.query('select id from auth.users where email=$1', [email])).rows[0]?.id as string | undefined;
    if (!actor) {
      const created = await admin.auth.admin.createUser({ email, password: randomUUID() + 'Aa9!', email_confirm: true, user_metadata: { full_name: 'Field Sales Test' } });
      if (created.error || !created.data.user) throw new Error('pilot_account_creation_failed');
      actor = created.data.user.id;
    }
    if (!(await pool.query('select 1 from auth.users where id=$1 and email=$2', [actor, email])).rowCount) throw new Error('test_stack_mismatch');
    let org = (await pool.query("select id from organizations where slug='field-sales-manual-pilot'")).rows[0]?.id as string | undefined;
    if (!org) {
      org = randomUUID();
      await pool.query(`insert into organizations(id,slug,legal_name,display_name,timezone,currency,locale,onboarded_at,onboarding_state)
        values($1,'field-sales-manual-pilot','Field Sales Test','Field Sales Test','Asia/Dubai','AED','en',now(),'{"welcome":{"country_code":"AE"}}')`, [org]);
    }
    await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'admin',now()) on conflict(user_id,organization_id) do nothing", [actor, org]);
    await pool.query("insert into field_sales_employees(organization_id,user_id,display_name) values($1,$2,'Test salesperson') on conflict do nothing", [org, actor]);
    await pool.query(`insert into field_sales_settings(organization_id,enabled,retention_days,notice_text)
      values($1,true,7,'LOCAL TEST ONLY: GPS during punch-in and declared breaks. Punch out to stop. No live organization data.') on conflict do nothing`, [org]);
    if (!(await pool.query('select 1 from field_sales_projects where organization_id=$1', [org])).rowCount) {
      for (const name of ['Showroom visit', 'Customer follow-up']) {
        const project = randomUUID(), schedule = randomUUID();
        await pool.query('insert into field_sales_projects(organization_id,id,name,site_name,instructions) values($1,$2,$3,$4,$5)', [org, project, name, 'Synthetic test site', 'Manual pilot only. Do not enter real customer details.']);
        const rule = { project_id: project, employee_id: actor, start_date: '2026-09-19', end_date: null, start_time: name === 'Showroom visit' ? '09:00' : '14:00', end_time: name === 'Showroom visit' ? '11:00' : '16:00', end_day_offset: 0, repeat: 'weekly', weekdays: [1,2,3,4,5,6,7], instructions: 'Synthetic manual test assignment' };
        await pool.query('insert into field_sales_schedules(organization_id,id,project_id,employee_id,country_code,timezone,rule) values($1,$2,$3,$4,$5,$6,$7)', [org, schedule, project, actor, 'AE', 'Asia/Dubai', rule]);
      }
    }
    if (process.argv.includes('--pair')) {
      const adb = process.env.LOCAL_PILOT_ADB;
      if (!adb) throw new Error('adb_path_required');
      const key = await issueFieldDevice(pool, org, actor, 'Samsung local manual pilot');
      const pairing = spawnSync(adb, ['shell','am','instrument','-w','-e','field_pilot_key',key.token,'-e','field_pilot_org',org,'-e','field_pilot_actor',actor,'com.fieldcrm.sales.test/com.fieldcrm.sales.SmokeInstrumentation'], { encoding: 'utf8', timeout: 60000 });
      if (pairing.status !== 0 || !pairing.stdout.includes('LOCAL PAIRING PASS')) {
        await pool.query('update field_sales_devices set revoked_at=now() where organization_id=$1 and id=$2', [org, key.id]);
        throw new Error('local_pairing_failed_key_revoked');
      }
      process.stdout.write('Local Samsung pairing verified. Key stored encrypted on phone; not printed.\n');
    }
    process.stdout.write('Persistent local account: field-pilot@synthetic.test; organization: Field Sales Test. Live data unchanged.\n');
  } finally { await pool.end(); }
}
main().catch(error => { process.stderr.write(`Pilot setup stopped: ${error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'review_local_setup'}; type ${error?.name}; database code ${/^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : 'unavailable'}; constraint ${/^[a-z_]+$/.test(error?.constraint ?? '') ? error.constraint : 'unavailable'}; stage ${String(error?.stack).match(/field-sales-local-pilot.ts:\d+:\d+/)?.[0] ?? 'unknown'}\n`); process.exitCode = 1; });
