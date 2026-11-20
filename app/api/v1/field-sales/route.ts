import { ok, fail } from '@/lib/api/wrappers';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { manageFieldSales, readFieldCalendar } from '@/lib/field-sales/management';
import { readIntegrationJson } from '../integration-connections/_shared';
import { fieldError } from './_shared';

export const dynamic = 'force-dynamic';
const noStore = { 'Cache-Control': 'private, no-store' };

export async function GET(req: Request) {
  const auth = await requireRole('field_officer'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Employee location data is unavailable in support sessions.', 403);
  try {
    const pool = getRequestPool();
    const installed = (await pool.query("select to_regclass('public.field_sales_settings') is not null installed")).rows[0].installed;
    if (!installed) return ok({ installed: false }, { headers: noStore });
    const query = new URL(req.url).searchParams;
    const data = await readFieldCalendar(pool, auth.org.orgId, auth.user.id, query.get('from') ?? '', query.get('through') ?? '');
    return ok({ installed: true, ...data }, { headers: noStore });
  } catch (error) { return fieldError(error); }
}

export async function POST(req: Request) {
  const support = await requireSupportWrite(); if (support) return support;
  const auth = await requireRole('manager'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Use your own organization account for Field Sales.', 403);
  try {
    return ok(await manageFieldSales(getRequestPool(), auth.org.orgId, auth.user.id, await readIntegrationJson(req)), { headers: noStore });
  } catch (error) { return fieldError(error); }
}
