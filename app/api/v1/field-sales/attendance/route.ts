import { ok, fail } from '@/lib/api/wrappers';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { readIntegrationJson } from '../../integration-connections/_shared';
import { fieldError } from '../_shared';
import { manageAttendanceLeave, manageAttendanceShift, readAttendanceDay } from '@/lib/field-sales/attendance-calendar';

const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(req: Request) {
  const auth = await requireRole('field_officer'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Employee records are unavailable in support sessions.', 403);
  try {
    const query = new URL(req.url).searchParams;
    return ok(await readAttendanceDay(getRequestPool(), auth.org.orgId, auth.user.id,
      query.get('date') ?? '', query.get('employee_id')), { headers });
  } catch (error) { return fieldError(error); }
}
export async function POST(req: Request) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const auth = await requireRole('manager'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Use your own organization account for attendance.', 403);
  try {
    const command = await readIntegrationJson(req) as { operation?: string };
    const action = command.operation === 'close_shift' || command.operation === 'correct_shift'
      ? manageAttendanceShift : manageAttendanceLeave;
    return ok(await action(getRequestPool(), auth.org.orgId, auth.user.id, command), { headers });
  } catch (error) { return fieldError(error); }
}
