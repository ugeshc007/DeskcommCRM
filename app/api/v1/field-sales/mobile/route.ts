import { z } from 'zod';
import { ok, fail } from '@/lib/api/wrappers';
import { authRateLimited } from '@/lib/auth/rate-limit';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { authenticateFieldDevice, revokeCurrentFieldDevice } from '@/lib/field-sales/devices';
import { recordAttendance, recordLocations } from '@/lib/field-sales/attendance';
import { readFieldCalendar } from '@/lib/field-sales/management';
import { fieldTransaction, withFieldDevice } from '@/lib/field-sales/authority';
import { attendanceCommandSchema, locationBatchSchema } from '@/lib/field-sales/contracts';
import { recordVisit, visitCommandSchema, completeNextAction, completeNextActionSchema } from '@/lib/field-sales/operations';
import { readFieldJson } from '@/lib/field-sales/request';
import { photoCommandSchema, saveFieldPhoto } from '@/lib/field-sales/photos';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const envelope = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('attendance'), command: attendanceCommandSchema }),
  z.strictObject({ operation: z.literal('locations'), batch: locationBatchSchema }),
  z.strictObject({ operation: z.literal('visit'), command: visitCommandSchema }),
  z.strictObject({ operation: z.literal('complete_next_action'), command: completeNextActionSchema }),
  z.strictObject({ operation: z.literal('photo'), command: photoCommandSchema }),
  z.strictObject({ operation: z.literal('sign_out') }),
]);
async function handle(req: Request, write: boolean) {
  const authorization = req.headers.get('authorization');
  try {
    if (await authRateLimited('field_mobile', authorization, { ip: 1000, id: 120, windowSec: 60 }))
      return fail('rate_limited', 'Please retry after one minute.', 429, { headers: { ...headers, 'Retry-After': '60' } });
    const pool = getRequestPool(), auth = await authenticateFieldDevice(pool, authorization);
    return await withFieldDevice(auth, async () => {
    if (write) {
      const input = envelope.parse(await readFieldJson(req));
      const result = input.operation === 'attendance'
        ? await recordAttendance(pool, auth.org, auth.actor, input.command)
        : input.operation === 'locations' ? await recordLocations(pool, auth.org, auth.actor, input.batch, true)
        : input.operation === 'visit' ? await recordVisit(pool, auth.org, auth.actor, input.command)
        : input.operation === 'photo' ? await saveFieldPhoto(pool, auth.org, auth.actor, input.command)
        : input.operation === 'complete_next_action' ? await completeNextAction(pool, auth.org, auth.actor, input.command)
        : await revokeCurrentFieldDevice(pool, auth.org, auth.actor, auth.deviceId);
      return ok(result, { headers });
    }
    const query = new URL(req.url).searchParams;
    const calendar = await readFieldCalendar(pool, auth.org, auth.actor, query.get('from') ?? '', query.get('through') ?? '');
    // Even when a manager enrolls themselves, this credential exposes only their own work.
    const occurrences = calendar.occurrences.filter(o => o.employee_id === auth.actor);
    const projects = await fieldTransaction(pool, auth.org, auth.actor, async db => (await db.query(`select id,name,site_name
      from public.field_sales_projects where organization_id=$1 and active order by name limit 500`, [auth.org])).rows);
    const sessions = await fieldTransaction(pool, auth.org, auth.actor, async db => (await db.query(`select s.id,s.status,s.punched_in_at,s.punched_out_at,s.last_sequence,
      s.project_id,s.schedule_id,s.local_date::text,p.name as project_name,p.site_name
      from public.field_sales_sessions s left join public.field_sales_projects p on p.organization_id=s.organization_id and p.id=s.project_id
      where s.organization_id=$1 and s.employee_id=$2 order by s.punched_in_at desc limit 10`, [auth.org, auth.actor])).rows);
    const visits = await fieldTransaction(pool, auth.org, auth.actor, async db => (await db.query(`select v.id,v.schedule_id,v.local_date::text,v.status,v.notes,v.next_action,v.next_action_at,v.next_action_completed_at,v.revision,p.name as project_name
      from public.field_sales_visits v join public.field_sales_projects p on p.organization_id=v.organization_id and p.id=v.project_id
      where v.organization_id=$1 and p.organization_id=$1 and v.employee_id=$2 and (v.local_date between $3 and $4 or (v.next_action<>'' and v.next_action_completed_at is null and v.next_action_at<=now())) order by v.local_date limit 500`, [auth.org, auth.actor, query.get('from'), query.get('through')])).rows);
    return ok({ identity: { organization_id: auth.org, employee_id: auth.actor }, employee: calendar.employees.find(e => e.user_id === auth.actor), region: calendar.region,
      settings: calendar.settings, occurrences, projects, sessions, visits }, { headers });
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'field_device_unauthorized' || code === 'field_forbidden' || code === 'field_employee_unavailable')
      return fail('unauthenticated', 'Reconnect your Android device from your CRM account.', 401, { headers });
    if (error instanceof z.ZodError || error instanceof SyntaxError || code === 'invalid_request')
      return fail('validation_failed', 'The device request is invalid.', 422, { headers });
    if (/^field_/.test(code)) return fail(code, 'Sync needs attention. Open the app to review the work session or connection.', 409, { headers });
    return fail('service_unavailable', 'Sync is temporarily unavailable. Keep the pending records and retry.', 503, { headers });
  }
}
export function GET(req: Request) { return handle(req, false); }
export function POST(req: Request) { return handle(req, true); }
