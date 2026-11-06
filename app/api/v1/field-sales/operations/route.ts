import { z } from 'zod';
import { ok, fail } from '@/lib/api/wrappers';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { readFieldOperations, recordVisit, manageCorrection, completeNextAction } from '@/lib/field-sales/operations';
import { readIntegrationJson } from '../../integration-connections/_shared';
import { fieldError } from '../_shared';
import { dailyFieldReport, locationHistoryReport } from '@/lib/field-sales/reports';
import { fieldAudit, fieldTransaction } from '@/lib/field-sales/authority';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(req: Request) {
  const auth = await requireRole('field_officer'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Employee records are unavailable in support sessions.', 403);
  try {
    const query = new URL(req.url).searchParams;
    const date = query.get('date') ?? '', pool = getRequestPool();
    const employeeIds = query.getAll('employee_ids');
    const report = query.get('report');
    if (report === 'locations' && (!query.get('employee_id') || query.has('session_id') || employeeIds.length))
      return fail('validation_failed', 'Choose one employee and date for the location download.', 422, { headers });
    const data = await readFieldOperations(pool, auth.org.orgId, auth.user.id, date,
      query.get('session_id'), query.get('employee_id'), employeeIds.length ? employeeIds : null);
    if (report === 'daily') {
      const csv = dailyFieldReport(date, data.region.timezone, data.sessions, data.visits);
      await fieldTransaction(pool, auth.org.orgId, auth.user.id, db => fieldAudit(db, auth.org.orgId, auth.user.id, 'field_sales.daily_report_exported', auth.user.id));
      return ok({ csv, filename: `field-sales-${date}.csv` }, { headers });
    }
    if (report === 'locations') {
      const employeeId = query.get('employee_id')!;
      const employee = data.latest.find(person => person.employee_id === employeeId);
      if (!employee) throw new Error('field_forbidden');
      const csv = locationHistoryReport(date, data.region.timezone, employee.display_name, data.points);
      await fieldTransaction(pool, auth.org.orgId, auth.user.id, db => fieldAudit(db, auth.org.orgId,
        auth.user.id, 'field_sales.location_history_exported', employeeId, { date, points: data.points.length }));
      return ok({ csv, filename: `field-sales-locations-${date}-${employeeId}.csv`, count: data.points.length }, { headers });
    }
    return ok(data, { headers });
  } catch (error) { return fieldError(error); }
}
export async function POST(req: Request) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const auth = await requireRole('field_officer'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Use your own account for employee operations.', 403);
  try {
    const input = z.strictObject({ operation: z.enum(['visit', 'correction', 'complete_next_action']), command: z.unknown() }).parse(await readIntegrationJson(req));
    const action = input.operation === 'visit' ? recordVisit : input.operation === 'correction' ? manageCorrection : completeNextAction;
    return ok(await action(getRequestPool(), auth.org.orgId, auth.user.id, input.command), { headers });
  } catch (error) { return fieldError(error); }
}
