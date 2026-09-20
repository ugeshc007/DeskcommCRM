import { z } from 'zod';
import { ok, fail } from '@/lib/api/wrappers';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { readFieldOperations, recordVisit, manageCorrection, completeNextAction } from '@/lib/field-sales/operations';
import { readIntegrationJson } from '../../integration-connections/_shared';
import { fieldError } from '../_shared';
import { dailyFieldReport } from '@/lib/field-sales/reports';
import { fieldAudit, fieldTransaction } from '@/lib/field-sales/authority';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET(req: Request) {
  const auth = await requireRole('agent'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Employee records are unavailable in support sessions.', 403);
  try {
    const query = new URL(req.url).searchParams;
    const date = query.get('date') ?? '', pool = getRequestPool();
    const data = await readFieldOperations(pool, auth.org.orgId, auth.user.id, date,
      query.get('session_id'), query.get('employee_id'));
    if (query.get('report') === 'daily') {
      const csv = dailyFieldReport(date, data.region.timezone, data.sessions, data.visits);
      await fieldTransaction(pool, auth.org.orgId, auth.user.id, db => fieldAudit(db, auth.org.orgId, auth.user.id, 'field_sales.daily_report_exported', auth.user.id));
      return ok({ csv, filename: `field-sales-${date}.csv` }, { headers });
    }
    return ok(data, { headers });
  } catch (error) { return fieldError(error); }
}
export async function POST(req: Request) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const auth = await requireRole('agent'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Use your own account for employee operations.', 403);
  try {
    const input = z.strictObject({ operation: z.enum(['visit', 'correction', 'complete_next_action']), command: z.unknown() }).parse(await readIntegrationJson(req));
    const action = input.operation === 'visit' ? recordVisit : input.operation === 'correction' ? manageCorrection : completeNextAction;
    return ok(await action(getRequestPool(), auth.org.orgId, auth.user.id, input.command), { headers });
  } catch (error) { return fieldError(error); }
}
