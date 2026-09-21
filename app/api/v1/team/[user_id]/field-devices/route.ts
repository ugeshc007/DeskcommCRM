import { z } from 'zod';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { ok, fail } from '@/lib/api/wrappers';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { issueOfficerDevice, officerDevices, revokeOfficerDevice } from '@/lib/field-sales/devices';
import { fieldError } from '@/app/api/v1/field-sales/_shared';
import { readIntegrationJson } from '@/app/api/v1/integration-connections/_shared';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ user_id: string }> };

export async function GET(_req: Request, ctx: Context) {
  const auth = await requireRole('admin'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Device keys require your own organization account.', 403);
  try { return ok(await officerDevices(getRequestPool(), auth.org.orgId, auth.user.id, (await ctx.params).user_id), { headers }); }
  catch (error) { return fieldError(error); }
}

export async function POST(req: Request, ctx: Context) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const auth = await requireRole('admin'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Device keys require your own organization account.', 403);
  try {
    const input = z.strictObject({ label: z.string().trim().min(1).max(100), display_name: z.string().trim().min(1).max(160) }).parse(await readIntegrationJson(req));
    return ok(await issueOfficerDevice(getRequestPool(), auth.org.orgId, auth.user.id, (await ctx.params).user_id, input.display_name, input.label), { headers });
  } catch (error) { return fieldError(error); }
}

export async function DELETE(req: Request, ctx: Context) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const auth = await requireRole('admin'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Device keys require your own organization account.', 403);
  try {
    const input = z.strictObject({ id: z.uuid() }).parse(await readIntegrationJson(req));
    return ok(await revokeOfficerDevice(getRequestPool(), auth.org.orgId, auth.user.id, (await ctx.params).user_id, input.id), { headers });
  } catch (error) { return fieldError(error); }
}
