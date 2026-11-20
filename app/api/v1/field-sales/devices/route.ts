import { z } from 'zod';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { ok, fail } from '@/lib/api/wrappers';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { issueFieldDevice, listFieldDevices, revokeFieldDevice } from '@/lib/field-sales/devices';
import { readIntegrationJson } from '../../integration-connections/_shared';
import { fieldError } from '../_shared';
const noStore = { 'Cache-Control': 'private, no-store' };
export async function GET() {
  const auth = await requireRole('agent'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Device access is unavailable in support sessions.', 403);
  try { return ok(await listFieldDevices(getRequestPool(), auth.org.orgId, auth.user.id), { headers: noStore }); }
  catch (error) { return fieldError(error); }
}
export async function POST(req: Request) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const auth = await requireRole('agent'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Connect a device from your own employee account.', 403);
  try {
    const input = z.discriminatedUnion('operation', [
      z.strictObject({ operation: z.literal('connect'), label: z.string().trim().min(1).max(100) }),
      z.strictObject({ operation: z.literal('revoke'), id: z.uuid() }),
    ]).parse(await readIntegrationJson(req));
    const result = input.operation === 'connect'
      ? await issueFieldDevice(getRequestPool(), auth.org.orgId, auth.user.id, input.label)
      : await revokeFieldDevice(getRequestPool(), auth.org.orgId, auth.user.id, input.id);
    return ok(result, { headers: noStore });
  } catch (error) { return fieldError(error); }
}
