import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { recordAttendance, recordLocations } from '@/lib/field-sales/attendance';
import { closeExpiredFieldSessions } from '@/lib/field-sales/auto-close';
import { fieldTransaction, requireFieldScope, withFieldDevice } from '@/lib/field-sales/authority';
import { authenticateFieldDevice, deviceTokenHash, issueFieldDevice, issueOfficerDevice, officerDevices, revokeOfficerDevice, listFieldDevices, revokeCurrentFieldDevice, revokeFieldDevice, redeemFieldPairingCode, pairingCodeHash } from '@/lib/field-sales/devices';
import { completeNextAction, manageCorrection, readFieldOperations, recordVisit } from '@/lib/field-sales/operations';
import { manageFieldSales, readFieldCalendar } from '@/lib/field-sales/management';
import { saveFieldPhoto, readFieldPhoto, listFieldPhotos, deleteFieldPhoto } from '@/lib/field-sales/photos';
import sharp from 'sharp';

if (!process.env.TEST_DB_CONTAINER) throw new Error('Run through scripts/test-db.sh');
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres` });
afterAll(() => pool.end());
beforeAll(async () => {
  process.env.INTERNAL_SECRET ||= 'synthetic-pairing-secret-for-disposable-database-tests';
  expect((await pool.query("select to_regclass('public.field_sales_locations') relation")).rows[0].relation).toBeNull();
  expect((await pool.query('select fn_expurgar_field_sales_locations(1000) n')).rows[0].n).toBe(0);
  await pool.query('select fn_provision_field_sales_module()');
  await pool.query('select fn_provision_field_sales_photos()');
  await pool.query('select fn_provision_field_sales_flexible_shifts()');
  await pool.query('select fn_provision_field_sales_flexible_shifts()');
  await pool.query('select fn_provision_field_sales_photos()');
  await pool.query('select fn_provision_field_sales_devices()');
  await pool.query('select fn_provision_field_sales_pairing()');
  await pool.query('select fn_provision_field_sales_operations()');
  await pool.query('select fn_provision_field_sales_operations()');
  await pool.query('select fn_provision_field_sales_lifecycle()');
  await pool.query('select fn_provision_field_sales_followups()');
  await pool.query('select fn_provision_field_sales_followups()');
  await pool.query('select fn_provision_field_sales_lifecycle()');
  await pool.query('select fn_provision_field_sales_devices()');
  await pool.query('select fn_provision_field_sales_module()');
});
async function fixture(startAt?: string) {
  const org = randomUUID(), actor = randomUUID(), manager = randomUUID();
  await pool.query(`insert into organizations(id,slug,legal_name,display_name,currency,timezone,onboarding_state)
    values($1,$2::text,$2::text,$2::text,'AED','Asia/Dubai','{"welcome":{"country_code":"AE"}}')`, [org, `field-${org}`]);
  for (const [id, role] of [[actor, 'agent'], [manager, 'manager']]) {
    await pool.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@synthetic.test`]);
    await pool.query('insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,$3,now())', [id, org, role]);
  }
  await pool.query("insert into field_sales_settings(organization_id,enabled,retention_days,notice_text) values($1,true,7,'Synthetic test policy')", [org]);
  await pool.query("insert into field_sales_employees(organization_id,user_id,display_name) values($1,$2,'Synthetic employee')", [org, actor]);
  const session = randomUUID(), start = startAt ?? new Date(Date.now() - 3600000).toISOString();
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dubai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(start));
  const project = randomUUID(), schedule = randomUUID();
  await pool.query("insert into field_sales_projects(organization_id,id,name,site_name) values($1,$2,'Punch-in project','Punch-in site')", [org, project]);
  const rule = { project_id: project, employee_id: actor, start_date: localDate, end_date: null, start_time: '00:00', end_time: '23:59', end_day_offset: 0, repeat: 'once', weekdays: [], instructions: '' };
  await pool.query("insert into field_sales_schedules(organization_id,id,employee_id,project_id,timezone,country_code,rule) values($1,$2,$3,$4,'Asia/Dubai','AE',$5)", [org, schedule, actor, project, JSON.stringify(rule)]);
  const command = { event_id: randomUUID(), session_id: session, action: 'punch_in' as const, sequence: 0, captured_at: start,
    project_id: project, schedule_id: schedule, local_date: localDate };
  return { org, actor, manager, session, command, start, project, schedule, localDate };
}

describe('optional field-sales foundation', () => {
  it('keeps Field Officer below viewer and binds admin-issued keys to one employee and organization', async () => {
    const f = await fixture(), other = await fixture(), officer = randomUUID(), admin = randomUUID();
    for (const [id, role] of [[officer, 'field_officer'], [admin, 'admin']]) {
      await pool.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@synthetic.test`]);
      await pool.query('insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,$3,now())', [id, f.org, role]);
    }
    const db = await pool.connect();
    try {
      await db.query('begin');
      await db.query('set local role authenticated');
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [officer]);
      expect((await db.query('select public.fn_role_at_least($1,\'viewer\') allowed', [f.org])).rows[0].allowed).toBe(false);
      expect((await db.query('select public.fn_user_org_ids() as organization_id')).rows).toEqual([]);
      expect((await db.query('select count(*)::int n from public.contacts where organization_id=$1', [f.org])).rows[0].n).toBe(0);
    } finally { await db.query('rollback'); db.release(); }
    await expect(issueOfficerDevice(pool, other.org, other.actor, officer, 'Officer', 'Samsung')).rejects.toThrow('field_forbidden');
    await expect(issueOfficerDevice(pool, f.org, f.manager, officer, 'Officer', 'Samsung')).rejects.toThrow('field_forbidden');
    const issued = await issueOfficerDevice(pool, f.org, admin, officer, 'Officer', 'Samsung');
    expect(issued.code).toMatch(/^\d{6}$/);
    await expect(authenticateFieldDevice(pool, `Bearer ${issued.code}`)).rejects.toThrow('field_device_unauthorized');
    const paired = await redeemFieldPairingCode(pool, issued.code);
    const identity = await authenticateFieldDevice(pool, `Bearer ${paired.token}`);
    expect(identity).toMatchObject({ org: f.org, actor: officer });
    await expect(redeemFieldPairingCode(pool, issued.code)).rejects.toThrow('field_pairing_invalid');
    expect(await officerDevices(pool, f.org, admin, officer)).toHaveLength(1);
    await expect(officerDevices(pool, other.org, other.actor, officer)).rejects.toThrow('field_forbidden');
    await revokeOfficerDevice(pool, f.org, admin, officer, issued.id);
    await expect(authenticateFieldDevice(pool, `Bearer ${paired.token}`)).rejects.toThrow('field_device_unauthorized');
  });
  it('accepts ordered offline visits after punch-out, rejects off-duty and break captures', async () => {
    const f = await fixture(), a = await assignment(f), visit = randomUUID();
    await recordAttendance(pool, f.org, f.actor, f.command);
    const at = (offset: number) => new Date(Date.parse(f.start) + offset).toISOString();
    await recordAttendance(pool, f.org, f.actor, { ...f.command, event_id: randomUUID(), action: 'break_start', sequence: 1, captured_at: at(600000) });
    await recordAttendance(pool, f.org, f.actor, { ...f.command, event_id: randomUUID(), action: 'break_end', sequence: 2, captured_at: at(1200000) });
    await recordAttendance(pool, f.org, f.actor, { ...f.command, event_id: randomUUID(), action: 'punch_out', sequence: 3, captured_at: at(2400000) });
    const base = { command_id: randomUUID(), visit_id: visit, schedule_id: a.schedule, date: a.date, session_id: f.session,
      action: 'travel', notes: '', next_action: '', next_action_at: null, captured_at: at(1000) };
    await recordVisit(pool, f.org, f.actor, base);
    expect((await recordVisit(pool, f.org, f.actor, base)).replayed).toBe(true);
    await expect(recordVisit(pool, f.org, f.actor, { ...base, command_id: randomUUID(), action: 'arrive', captured_at: at(900000) })).rejects.toThrow('field_work_session_required');
    await recordVisit(pool, f.org, f.actor, { ...base, command_id: randomUUID(), action: 'arrive', captured_at: at(1500000) });
    await expect(recordVisit(pool, f.org, f.actor, { ...base, command_id: randomUUID(), action: 'complete', notes: 'Done', captured_at: at(2500000) })).rejects.toThrow('field_work_session_required');
    await recordVisit(pool, f.org, f.actor, { ...base, command_id: randomUUID(), action: 'complete', notes: 'Done', captured_at: at(2300000) });
    const saved = (await pool.query('select completed_at from field_sales_visits where organization_id=$1 and id=$2', [f.org, visit])).rows[0];
    expect(saved.completed_at.toISOString()).toBe(at(2300000));
  });
  it('isolates private photos by employee and org, strips metadata and cascades visit deletion', async () => {
    const f = await fixture(), other = await fixture(), a = await assignment(f), visit = randomUUID();
    await recordAttendance(pool, f.org, f.actor, f.command);
    await recordVisit(pool, f.org, f.actor, { command_id: randomUUID(), visit_id: visit, schedule_id: a.schedule, date: a.date,
      session_id: f.session, action: 'travel', notes: '', next_action: '', next_action_at: null });
    const bytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#aabbcc' } }).jpeg().withMetadata().toBuffer();
    const photo = { id: randomUUID(), visit_id: visit, captured_at: new Date().toISOString(), image_base64: bytes.toString('base64') };
    await expect(saveFieldPhoto(pool, other.org, other.actor, photo)).rejects.toThrow('field_forbidden');
    await expect(saveFieldPhoto(pool, f.org, f.manager, photo)).rejects.toThrow();
    expect((await saveFieldPhoto(pool, f.org, f.actor, photo)).replayed).toBe(false);
    expect((await saveFieldPhoto(pool, f.org, f.actor, photo)).replayed).toBe(true);
    await expect(readFieldPhoto(pool, f.org, f.manager, photo.id)).rejects.toThrow('field_forbidden');
    await expect(readFieldPhoto(pool, other.org, other.actor, photo.id)).rejects.toThrow('field_forbidden');
    expect(await listFieldPhotos(pool, f.org, f.actor, visit)).toHaveLength(1);
    const normalized = Buffer.from(await readFieldPhoto(pool, f.org, f.actor, photo.id), 'base64');
    expect((await sharp(normalized).metadata()).exif).toBeUndefined();
    await expect(deleteFieldPhoto(pool, other.org, other.actor, photo.id)).rejects.toThrow('field_forbidden');
    await expect(deleteFieldPhoto(pool, f.org, f.manager, photo.id)).rejects.toThrow('field_forbidden');
    expect(await deleteFieldPhoto(pool, f.org, f.actor, photo.id)).toEqual({ deleted: true });
    await expect(readFieldPhoto(pool, f.org, f.actor, photo.id)).rejects.toThrow('field_forbidden');
    await saveFieldPhoto(pool, f.org, f.actor, { ...photo, id: randomUUID() });
    await pool.query('delete from field_sales_visit_events where organization_id=$1 and visit_id=$2', [f.org, visit]);
    await pool.query('delete from field_sales_visits where organization_id=$1 and id=$2', [f.org, visit]);
    expect((await pool.query('select count(*)::int n from field_sales_photos where organization_id=$1', [f.org])).rows[0].n).toBe(0);
  });
  it('closes next-action reminders only within scope and preserves the original action', async () => {
    const f = await fixture(), other = await fixture(), a = await assignment(f);
    await recordAttendance(pool, f.org, f.actor, f.command);
    const visitId = randomUUID();
    await recordVisit(pool, f.org, f.actor, { command_id: randomUUID(), visit_id: visitId, schedule_id: a.schedule, date: a.date,
      session_id: f.session, action: 'travel', notes: '', next_action: 'Call the customer', next_action_at: new Date(Date.now() - 60000).toISOString() });
    const command = { visit_id: visitId, revision: 1 };
    await expect(completeNextAction(pool, other.org, other.actor, command)).rejects.toThrow('field_forbidden');
    await expect(completeNextAction(pool, f.org, f.manager, command)).rejects.toThrow('field_forbidden');
    await pool.query("insert into field_sales_employees(organization_id,user_id,display_name) values($1,$2,'Synthetic manager')", [f.org, f.manager]);
    await pool.query('insert into field_sales_manager_scope(organization_id,manager_id,employee_id) values($1,$2,$3)', [f.org, f.manager, f.actor]);
    const key = await issueFieldDevice(pool, f.org, f.manager, 'Manager own device');
    const identity = await authenticateFieldDevice(pool, `Bearer ${(await redeemFieldPairingCode(pool, key.code)).token}`);
    await expect(withFieldDevice(identity, () => completeNextAction(pool, f.org, f.manager, command))).rejects.toThrow('field_forbidden');
    expect((await completeNextAction(pool, f.org, f.actor, command)).replayed).toBe(false);
    expect((await completeNextAction(pool, f.org, f.actor, command)).replayed).toBe(true);
    const saved = (await pool.query('select next_action,next_action_completed_at from field_sales_visits where organization_id=$1 and id=$2', [f.org, visitId])).rows[0];
    expect(saved.next_action).toBe('Call the customer'); expect(saved.next_action_completed_at).not.toBeNull();
    expect((await pool.query("select count(*)::int n from api_audit_log where organization_id=$1 and action='field_sales.next_action_completed'", [f.org])).rows[0].n).toBe(1);
  });
  it('acknowledges rejected offline GPS without blocking valid points or crossing organization scope', async () => {
    const f = await fixture(), other = await fixture();
    await recordAttendance(pool, f.org, f.actor, f.command);
    await recordAttendance(pool, other.org, other.actor, other.command);
    const valid = { sample_id: randomUUID(), session_id: f.session, sequence: 0, captured_at: f.start,
      latitude: 1, longitude: 2, accuracy_m: 3, mock_location: false };
    const foreign = { ...valid, sample_id: randomUUID(), session_id: other.session };
    const outside = { ...valid, sample_id: randomUUID(), sequence: 1, captured_at: new Date(Date.parse(f.start) - 1000).toISOString() };
    const result = await recordLocations(pool, f.org, f.actor, { samples: [foreign, valid, outside] }, true);
    expect(result.accepted).toEqual([valid.sample_id]);
    expect(result.rejected).toEqual([foreign, outside].map(s => ({ sample_id: s.sample_id, reason: 'field_outside_work_session' })));
    expect(result.inserted).toBe(1);
    expect((await recordLocations(pool, f.org, f.actor, { samples: [valid] }, true)).inserted).toBe(0);
    expect((await pool.query('select count(*)::int n from field_sales_locations where organization_id=$1', [other.org])).rows[0].n).toBe(0);
    await expect(recordLocations(pool, f.org, f.actor, { samples: [outside] })).rejects.toThrow('field_outside_work_session');
  });
  it('lists manager grants only to admins and can revoke after the employee becomes inactive', async () => {
    const f = await fixture();
    await pool.query("update user_organizations set role='admin' where organization_id=$1 and user_id=$2", [f.org, f.actor]);
    await manageFieldSales(pool, f.org, f.actor, { operation: 'manager_scope', manager_id: f.manager, employee_id: f.actor, granted: true });
    const date = new Date().toISOString().slice(0, 10);
    expect((await readFieldCalendar(pool, f.org, f.actor, date, date)).manager_scopes).toHaveLength(1);
    expect((await readFieldCalendar(pool, f.org, f.manager, date, date)).manager_scopes).toEqual([]);
    await pool.query('update field_sales_employees set active=false where organization_id=$1 and user_id=$2', [f.org, f.actor]);
    await pool.query('update user_organizations set revoked_at=now() where organization_id=$1 and user_id=$2', [f.org, f.manager]);
    await manageFieldSales(pool, f.org, f.actor, { operation: 'manager_scope', manager_id: f.manager, employee_id: f.actor, granted: false });
    expect((await readFieldCalendar(pool, f.org, f.actor, date, date)).manager_scopes).toEqual([]);
  });
  async function assignment(f: Awaited<ReturnType<typeof fixture>>, date = new Date().toISOString().slice(0, 10)) {
    const project = randomUUID(), schedule = randomUUID();
    await pool.query("insert into field_sales_projects(organization_id,id,name,site_name) values($1,$2,'Synthetic project','Synthetic site')", [f.org, project]);
    const rule = { project_id: project, employee_id: f.actor, start_date: date, end_date: null, start_time: '09:00', end_time: '10:00', end_day_offset: 0, repeat: 'once', weekdays: [], instructions: '' };
    await pool.query("insert into field_sales_schedules(organization_id,id,employee_id,project_id,timezone,country_code,rule) values($1,$2,$3,$4,'Asia/Dubai','AE',$5)", [f.org, schedule, f.actor, project, JSON.stringify(rule)]);
    return { project, schedule, rule, date };
  }
  it('removes only the deleted organization history and still protects individual employees', async () => {
    const f = await fixture(), other = await fixture(), a = await assignment(f);
    await recordAttendance(pool, f.org, f.actor, f.command);
    await recordAttendance(pool, other.org, other.actor, other.command);
    await recordLocations(pool, f.org, f.actor, { samples: [{ sample_id: randomUUID(), session_id: f.session, sequence: 0, captured_at: f.start, latitude: 1, longitude: 2, accuracy_m: 3, mock_location: false }] });
    await recordVisit(pool, f.org, f.actor, { command_id: randomUUID(), visit_id: randomUUID(), schedule_id: a.schedule, date: a.date, session_id: f.session, action: 'travel', notes: '', next_action: '', next_action_at: null });
    await expect(pool.query('delete from field_sales_employees where organization_id=$1 and user_id=$2', [f.org, f.actor])).rejects.toMatchObject({ code: '23503' });
    await pool.query('delete from organizations where id=$1', [f.org]);
    expect((await pool.query('select count(*)::int n from field_sales_locations where organization_id=$1', [f.org])).rows[0].n).toBe(0);
    expect((await pool.query('select count(*)::int n from field_sales_sessions where organization_id=$1', [other.org])).rows[0].n).toBe(1);
  });
  it('records only assigned employee visits, replays commands once and protects completed history', async () => {
    const f = await fixture(), other = await fixture(), a = await assignment(f);
    await recordAttendance(pool, f.org, f.actor, f.command);
    const visit = { command_id: randomUUID(), visit_id: randomUUID(), schedule_id: a.schedule, date: a.date, session_id: f.session,
      action: 'travel', notes: '', next_action: '', next_action_at: null };
    await expect(recordVisit(pool, other.org, other.actor, visit)).rejects.toThrow('field_assignment_unavailable');
    expect((await recordVisit(pool, f.org, f.actor, visit)).replayed).toBe(false);
    expect((await recordVisit(pool, f.org, f.actor, visit)).replayed).toBe(true);
    await recordVisit(pool, f.org, f.actor, { ...visit, command_id: randomUUID(), action: 'arrive' });
    await expect(recordVisit(pool, f.org, f.actor, { ...visit, command_id: randomUUID(), action: 'complete' })).rejects.toThrow('field_visit_outcome_required');
    await recordVisit(pool, f.org, f.actor, { ...visit, command_id: randomUUID(), action: 'complete', notes: 'Synthetic outcome' });
    await expect(recordVisit(pool, f.org, f.actor, { ...visit, command_id: randomUUID() })).rejects.toThrow('field_invalid_transition');
    await pool.query('insert into field_sales_manager_scope(organization_id,manager_id,employee_id) values($1,$2,$3)', [f.org, f.manager, f.actor]);
    await expect(manageFieldSales(pool, f.org, f.manager, { operation: 'cancel_occurrence', id: a.schedule, revision: 1, date: a.date })).rejects.toThrow('field_history_immutable');
  });
  it('requires independent scoped correction approval and preserves original capture intervals', async () => {
    const f = await fixture(), other = await fixture();
    await recordAttendance(pool, f.org, f.actor, f.command);
    const out = new Date(Date.now() - 1800000).toISOString();
    await recordAttendance(pool, f.org, f.actor, { ...f.command, event_id: randomUUID(), action: 'punch_out', sequence: 1, captured_at: out });
    const correction = { operation: 'request', id: randomUUID(), session_id: f.session, proposed_in: f.start, proposed_out: out, reason: 'Synthetic clock correction' };
    await manageCorrection(pool, f.org, f.actor, correction);
    const review = { operation: 'review', id: correction.id, decision: 'approved', note: 'Checked synthetic evidence' };
    await expect(manageCorrection(pool, f.org, f.actor, review)).rejects.toThrow('field_forbidden');
    await expect(manageCorrection(pool, other.org, other.manager, review)).rejects.toThrow('field_forbidden');
    await expect(manageCorrection(pool, f.org, f.manager, review)).rejects.toThrow('field_forbidden');
    await pool.query('insert into field_sales_manager_scope(organization_id,manager_id,employee_id) values($1,$2,$3)', [f.org, f.manager, f.actor]);
    await manageCorrection(pool, f.org, f.manager, review);
    const original = (await pool.query('select punched_in_at,punched_out_at from field_sales_sessions where organization_id=$1 and id=$2', [f.org, f.session])).rows[0];
    expect(original.punched_in_at.toISOString()).toBe(f.start); expect(original.punched_out_at.toISOString()).toBe(out);
    await expect(manageCorrection(pool, f.org, f.manager, review)).rejects.toThrow('field_revision_conflict');
  });
  it('hides other employees and off-duty current positions while permitting authorized historical routes', async () => {
    const f = await fixture(), other = await fixture(), date = f.localDate;
    await recordAttendance(pool, f.org, f.actor, f.command);
    await recordLocations(pool, f.org, f.actor, { samples: [{ sample_id: randomUUID(), session_id: f.session, sequence: 0, captured_at: f.start, latitude: 1, longitude: 2, accuracy_m: 3, mock_location: false }] });
    expect((await readFieldOperations(pool, f.org, f.manager, date)).latest).toEqual([]);
    await expect(readFieldOperations(pool, other.org, other.actor, date, f.session)).rejects.toThrow('field_forbidden');
    await pool.query('insert into field_sales_manager_scope(organization_id,manager_id,employee_id) values($1,$2,$3)', [f.org, f.manager, f.actor]);
    expect((await readFieldOperations(pool, f.org, f.manager, date)).latest[0].latitude).toBe(1);
    await recordAttendance(pool, f.org, f.actor, { ...f.command, event_id: randomUUID(), action: 'punch_out', sequence: 1, captured_at: new Date().toISOString() });
    const history = await readFieldOperations(pool, f.org, f.manager, date, f.session);
    expect(history.latest[0].latitude).toBeNull(); expect(history.points).toHaveLength(1);
    const employeeDay = await readFieldOperations(pool, f.org, f.manager, date, null, f.actor);
    expect(employeeDay.points).toEqual([expect.objectContaining({ session_id: f.session, latitude: 1, longitude: 2 })]);
    await expect(readFieldOperations(pool, other.org, other.manager, date, null, f.actor)).rejects.toThrow('field_forbidden');
  });
  it('splits a future series atomically with optimistic revision protection', async () => {
    const f = await fixture(), a = await assignment(f, '2099-01-01');
    await pool.query('insert into field_sales_manager_scope(organization_id,manager_id,employee_id) values($1,$2,$3)', [f.org, f.manager, f.actor]);
    const edit = { operation: 'reschedule', id: a.schedule, revision: 1, new_id: randomUUID(), date: a.date, scope: 'one', schedule: { ...a.rule, start_time: '11:00', end_time: '12:00' } };
    await manageFieldSales(pool, f.org, f.manager, edit);
    const calendar = await readFieldCalendar(pool, f.org, f.actor, a.date, a.date);
    expect(calendar.occurrences).toHaveLength(1); expect(calendar.occurrences[0]!.starts_at).toBe('2099-01-01T07:00:00.000Z');
    await expect(manageFieldSales(pool, f.org, f.manager, edit)).rejects.toThrow('field_revision_conflict');
  });
  it('expires GPS using each organization policy while preserving attendance and auditing only deletions', async () => {
    const captured = new Date(Date.now() - 2 * 86400000).toISOString();
    const a = await fixture(captured), b = await fixture(captured);
    for (const f of [a, b]) {
      await recordAttendance(pool, f.org, f.actor, f.command);
      await recordLocations(pool, f.org, f.actor, { samples: [{ sample_id: randomUUID(), session_id: f.session,
        sequence: 0, captured_at: captured, latitude: 0, longitude: 0, accuracy_m: 1, mock_location: false }] });
    }
    await pool.query('update field_sales_settings set retention_days=1 where organization_id=$1', [a.org]);
    expect((await pool.query('select fn_expurgar_field_sales_locations(1) n')).rows[0].n).toBe(1);
    expect((await pool.query('select count(*)::int n from field_sales_locations where organization_id=$1', [a.org])).rows[0].n).toBe(0);
    expect((await pool.query('select count(*)::int n from field_sales_locations where organization_id=$1', [b.org])).rows[0].n).toBe(1);
    expect((await pool.query('select count(*)::int n from field_sales_sessions where organization_id=$1', [a.org])).rows[0].n).toBe(1);
    const audit = await pool.query("select metadata from api_audit_log where organization_id=$1 and action='field_sales.location_retention'", [a.org]);
    expect(audit.rows).toEqual([{ metadata: { deleted: 1 } }]);
    expect((await pool.query('select fn_expurgar_field_sales_locations(1000) n')).rows[0].n).toBe(0);
    expect((await pool.query("select count(*)::int n from api_audit_log where organization_id=$1 and action='field_sales.location_retention'", [a.org])).rows[0].n).toBe(1);
  });
  it('stores only a device hash, isolates ownership and rejects revoked or expired devices', async () => {
    const a = await fixture(), b = await fixture();
    const issued = await issueFieldDevice(pool, a.org, a.actor, 'Synthetic Android');
    expect(issued.code).toMatch(/^\d{6}$/);
    const pending = (await pool.query('select token_hash,pairing_code_hash from field_sales_devices where organization_id=$1 and id=$2', [a.org, issued.id])).rows[0];
    expect(pending.token_hash).toBeNull();
    expect(pending.pairing_code_hash).toBe(pairingCodeHash(issued.code));
    const paired = await redeemFieldPairingCode(pool, issued.code);
    const stored = (await pool.query('select token_hash,pairing_code_hash from field_sales_devices where organization_id=$1 and id=$2', [a.org, issued.id])).rows[0];
    expect(stored.token_hash).toBe(deviceTokenHash(paired.token));
    expect(stored.pairing_code_hash).toBeNull();
    expect(JSON.stringify(await listFieldDevices(pool, a.org, a.actor))).not.toContain(paired.token);
    expect(await listFieldDevices(pool, b.org, b.actor)).toEqual([]);
    await expect(revokeFieldDevice(pool, b.org, b.actor, issued.id)).rejects.toThrow('field_forbidden');
    const identity = await authenticateFieldDevice(pool, 'Bearer ' + paired.token);
    await withFieldDevice(identity, () => recordAttendance(pool, a.org, a.actor, a.command));
    await expect(withFieldDevice(identity, () => recordAttendance(pool, b.org, b.actor, b.command))).rejects.toThrow('field_device_unauthorized');
    await revokeFieldDevice(pool, a.org, a.actor, issued.id);
    await expect(authenticateFieldDevice(pool, 'Bearer ' + paired.token)).rejects.toThrow('field_device_unauthorized');
    // A previously authenticated request must revalidate at the actual transaction boundary.
    await expect(withFieldDevice(identity, () => recordAttendance(pool, a.org, a.actor, a.command))).rejects.toThrow('field_device_unauthorized');
    const expired = await issueFieldDevice(pool, b.org, b.actor, 'Expired synthetic device');
    await pool.query("update field_sales_devices set expires_at=now()-interval '1 second' where organization_id=$1 and id=$2", [b.org, expired.id]);
    await expect(redeemFieldPairingCode(pool, expired.code)).rejects.toThrow('field_pairing_invalid');
  });
  it('mobile sign-out revokes only its authenticated device and leaves another device usable', async () => {
    const f = await fixture();
    const first = await issueFieldDevice(pool, f.org, f.actor, 'First Android');
    const second = await issueFieldDevice(pool, f.org, f.actor, 'Second Android');
    const firstToken = (await redeemFieldPairingCode(pool, first.code)).token;
    const secondToken = (await redeemFieldPairingCode(pool, second.code)).token;
    const identity = await authenticateFieldDevice(pool, 'Bearer ' + firstToken);
    expect((await pool.query('select expires_at from field_sales_devices where organization_id=$1 and id=$2', [f.org, identity.deviceId])).rows[0].expires_at).toBeNull();
    expect(await revokeCurrentFieldDevice(pool, identity.org, identity.actor, identity.deviceId)).toEqual({ signed_out: true });
    await expect(authenticateFieldDevice(pool, 'Bearer ' + firstToken)).rejects.toThrow('field_device_unauthorized');
    await expect(authenticateFieldDevice(pool, 'Bearer ' + secondToken)).resolves.toMatchObject({ org: f.org, actor: f.actor });
    expect((await pool.query("select count(*)::int n from api_audit_log where organization_id=$1 and action='field_sales.device_signed_out'", [f.org])).rows[0].n).toBe(1);
  });
  it('denies anonymous/authenticated raw access and provisioning', async () => {
    for (const role of ['anon', 'authenticated']) {
      expect((await pool.query("select has_function_privilege($1,'public.fn_expurgar_field_sales_locations(integer)','EXECUTE') allowed", [role])).rows[0].allowed).toBe(false);
      expect((await pool.query("select has_function_privilege($1,'public.fn_provision_field_sales_module()','EXECUTE') allowed", [role])).rows[0].allowed).toBe(false);
      expect((await pool.query("select has_table_privilege($1,'public.field_sales_locations','SELECT') allowed", [role])).rows[0].allowed).toBe(false);
    }
    expect((await pool.query("select relrowsecurity from pg_class where oid='public.field_sales_locations'::regclass")).rows[0].relrowsecurity).toBe(true);
  });
  it('revalidates current membership and explicit manager assignment', async () => {
    const a = await fixture(), b = await fixture();
    await expect(fieldTransaction(pool, a.org, b.actor, async () => true)).rejects.toThrow('field_forbidden');
    await expect(fieldTransaction(pool, a.org, a.manager, (db, role) => requireFieldScope(db, a.org, a.manager, role, a.actor))).rejects.toThrow('field_forbidden');
    await pool.query('insert into field_sales_manager_scope(organization_id,manager_id,employee_id) values($1,$2,$3)', [a.org, a.manager, a.actor]);
    await fieldTransaction(pool, a.org, a.manager, (db, role) => requireFieldScope(db, a.org, a.manager, role, a.actor));
    await pool.query('update user_organizations set revoked_at=now() where organization_id=$1 and user_id=$2', [a.org, a.actor]);
    await expect(recordAttendance(pool, a.org, a.actor, a.command)).rejects.toThrow('field_forbidden');
  });
  it('punches once under concurrent retries and rejects a second device session', async () => {
    const f = await fixture();
    const results = await Promise.all([recordAttendance(pool, f.org, f.actor, f.command), recordAttendance(pool, f.org, f.actor, f.command)]);
    expect(results.filter(r => !r.replayed)).toHaveLength(1);
    await expect(recordAttendance(pool, f.org, f.actor, { ...f.command, event_id: randomUUID(), session_id: randomUUID() })).rejects.toThrow('field_session_already_active');
    await expect(recordAttendance(pool, f.org, f.actor, { ...f.command, captured_at: new Date().toISOString() })).rejects.toThrow('field_idempotency_conflict');
  });
  it('opens a session only for the authenticated employee selected occurrence', async () => {
    const f = await fixture(), other = await fixture();
    await expect(recordAttendance(pool, other.org, other.actor, { ...other.command, project_id: f.project, schedule_id: f.schedule })).rejects.toThrow('field_assignment_unavailable');
    await recordAttendance(pool, f.org, f.actor, f.command);
    const saved = (await pool.query('select project_id,schedule_id,local_date::text from field_sales_sessions where organization_id=$1 and id=$2', [f.org, f.session])).rows[0];
    expect(saved).toEqual({ project_id: f.project, schedule_id: f.schedule, local_date: f.localDate });
  });
  it('starts without a project, then audits an organization-scoped override', async () => {
    const f = await fixture(), other = await fixture();
    const { project_id: _project, schedule_id: _schedule, ...clockIn } = f.command;
    await recordAttendance(pool, f.org, f.actor, clockIn);
    const unassigned = (await pool.query('select project_id,schedule_id from field_sales_sessions where organization_id=$1 and id=$2', [f.org, f.session])).rows[0];
    expect(unassigned).toEqual({ project_id: null, schedule_id: null });
    const choose = { event_id: randomUUID(), session_id: f.session, action: 'select_project', sequence: 1,
      captured_at: new Date().toISOString(), project_id: f.project, schedule_id: null, local_date: f.localDate };
    await expect(recordAttendance(pool, f.org, f.actor, { ...choose, project_id: other.project })).rejects.toThrow('field_assignment_unavailable');
    await recordAttendance(pool, f.org, f.actor, choose);
    expect((await pool.query('select project_id,schedule_id from field_sales_sessions where organization_id=$1 and id=$2', [f.org, f.session])).rows[0])
      .toEqual({ project_id: f.project, schedule_id: null });
    expect((await pool.query("select metadata->>'override' as override from api_audit_log where organization_id=$1 and action='field_sales.select_project'", [f.org])).rows[0].override).toBe('true');
  });
  it('closes forgotten sessions at exactly fourteen hours and rejects later GPS', async () => {
    const start = new Date(Date.now() - 15 * 3600000).toISOString();
    const f = await fixture(start);
    await recordAttendance(pool, f.org, f.actor, f.command);
    expect((await closeExpiredFieldSessions(pool)).closed).toBeGreaterThanOrEqual(1);
    const cutoff = new Date(Date.parse(start) + 14 * 3600000).toISOString();
    const saved = (await pool.query('select punched_out_at,status from field_sales_sessions where organization_id=$1 and id=$2', [f.org, f.session])).rows[0];
    expect(saved.status).toBe('off_duty'); expect(saved.punched_out_at.toISOString()).toBe(cutoff);
    const point = { sample_id: randomUUID(), session_id: f.session, sequence: 0,
      captured_at: new Date(Date.parse(cutoff) - 1000).toISOString(), latitude: 25, longitude: 55, accuracy_m: 10, mock_location: false };
    expect((await recordLocations(pool, f.org, f.actor, { samples: [point] })).inserted).toBe(1);
    await expect(recordLocations(pool, f.org, f.actor, { samples: [{ ...point, sample_id: randomUUID(), sequence: 1, captured_at: cutoff }] }))
      .rejects.toThrow('field_outside_work_session');
    await recordAttendance(pool, f.org, f.actor, { ...f.command, event_id: randomUUID(), action: 'break_start', sequence: 1,
      captured_at: new Date(Date.parse(cutoff) - 120000).toISOString() });
    await recordAttendance(pool, f.org, f.actor, { ...f.command, event_id: randomUUID(), action: 'break_end', sequence: 2,
      captured_at: new Date(Date.parse(cutoff) - 60000).toISOString() });
    await recordAttendance(pool, f.org, f.actor, { ...f.command, event_id: randomUUID(), action: 'punch_out', sequence: 3, captured_at: cutoff });
    expect((await pool.query('select punched_out_at from field_sales_sessions where organization_id=$1 and id=$2', [f.org, f.session])).rows[0].punched_out_at.toISOString()).toBe(cutoff);
  });
  it('never accepts another employee/org session or off-duty points', async () => {
    const f = await fixture(), other = await fixture();
    await recordAttendance(pool, f.org, f.actor, f.command);
    const point = { sample_id: randomUUID(), session_id: f.session, sequence: 0,
      captured_at: new Date(Date.now() - 3500000).toISOString(), latitude: 25, longitude: 55, accuracy_m: 10, mock_location: false };
    await expect(recordLocations(pool, other.org, other.actor, { samples: [point] })).rejects.toThrow('field_outside_work_session');
    expect((await recordLocations(pool, f.org, f.actor, { samples: [point] })).inserted).toBe(1);
    expect((await recordLocations(pool, f.org, f.actor, { samples: [point] })).inserted).toBe(0);
    await expect(recordLocations(pool, f.org, f.actor, { samples: [{ ...point, latitude: 26 }] })).rejects.toThrow('field_idempotency_conflict');
    const stop = { ...f.command, event_id: randomUUID(), action: 'punch_out', sequence: 1, captured_at: point.captured_at };
    await recordAttendance(pool, f.org, f.actor, stop);
    expect((await pool.query('select count(*)::int n from field_sales_locations where organization_id=$1', [f.org])).rows[0].n).toBe(0);
    await expect(recordLocations(pool, f.org, f.actor, { samples: [point] })).rejects.toThrow('field_outside_work_session');
  });
  it('tracks declared breaks; disabled policy still permits punch-out', async () => {
    const f = await fixture();
    await recordAttendance(pool, f.org, f.actor, f.command);
    await recordAttendance(pool, f.org, f.actor, { ...f.command, event_id: randomUUID(), action: 'break_start', sequence: 1 });
    const point = { sample_id: randomUUID(), session_id: f.session, sequence: 0, captured_at: f.start,
      latitude: 25, longitude: 55, accuracy_m: 10, mock_location: false };
    await recordLocations(pool, f.org, f.actor, { samples: [point] });
    await pool.query('update field_sales_settings set enabled=false where organization_id=$1', [f.org]);
    await expect(recordLocations(pool, f.org, f.actor, { samples: [point] })).rejects.toThrow('field_tracking_disabled');
    await recordAttendance(pool, f.org, f.actor, { ...f.command, event_id: randomUUID(), action: 'punch_out', sequence: 2 });
  });
  it('requires ordered attendance and rejects future clock or retention-expired GPS', async () => {
    const f = await fixture();
    await expect(recordAttendance(pool, f.org, f.actor, { ...f.command, captured_at: new Date(Date.now() + 600000).toISOString() })).rejects.toThrow('field_device_clock_ahead');
    await recordAttendance(pool, f.org, f.actor, f.command);
    await expect(recordAttendance(pool, f.org, f.actor, { ...f.command, event_id: randomUUID(), action: 'punch_out', sequence: 2 })).rejects.toThrow('field_sync_out_of_order');
    const audit = await pool.query("select metadata from api_audit_log where organization_id=$1 and action like 'field_sales.%'", [f.org]);
    expect(JSON.stringify(audit.rows)).not.toMatch(/latitude|longitude/);
  });
  it('composite foreign keys prevent cross-organization project assignment', async () => {
    const a = await fixture(), b = await fixture(), id = randomUUID();
    await pool.query("insert into field_sales_projects(organization_id,id,name,site_name) values($1,$2,'Synthetic','Site')", [a.org, id]);
    await expect(pool.query(`insert into field_sales_schedules(organization_id,project_id,employee_id,timezone,country_code,rule)
      values($1,$2,$3,'Asia/Dubai','AE','{}')`, [b.org, id, b.actor])).rejects.toThrow();
  });
});
