import { randomBytes, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { ok, fail } from '@/lib/api/wrappers';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { createAdminClient } from '@/lib/supabase/admin';
import { isExistingAccountError } from '@/lib/auth/existing-account-error';
import { assertSaasCapacity, SaasCapacityError } from '@/lib/saas/capacity';
import { audit, hashEmail } from '@/lib/audit';
import { logger } from '@/lib/logger';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { manageFieldSales } from '@/lib/field-sales/management';

export const dynamic = 'force-dynamic';

const createFieldMemberSchema = z.strictObject({
  email: z.string().trim().email().transform(value => value.toLowerCase()),
  full_name: z.string().trim().min(1).max(160),
  role: z.enum(['field_officer', 'promoter']),
});

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = randomUUID();
  const supportDenied = await requireSupportWrite();
  if (supportDenied) return supportDenied;
  const auth = await requireRole('manager', { requestId, resource: 'team' });
  if (!auth.ok) return auth.response;
  const { org, user } = auth;
  const parsed = createFieldMemberSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail('validation_error', 'Enter a valid name, email, and field role.', 400, { requestId });
  const { email, full_name: fullName, role } = parsed.data;
  try { await assertSaasCapacity(org.orgId, 'members', 1); }
  catch (error) {
    if (error instanceof SaasCapacityError) return fail(error.code, 'Member capacity is unavailable.', error.code === 'plan_limit_reached' ? 409 : 503, { requestId });
    throw error;
  }

  const admin = createAdminClient();
  const created = await admin.auth.admin.createUser({
    email,
    password: randomBytes(48).toString('base64url'),
    email_confirm: true,
    user_metadata: { full_name: fullName, enrollment_method: 'manager_created_field_worker' },
  });
  if (created.error || !created.data.user) return fail(isExistingAccountError(created.error) ? 'conflict' : 'internal_error',
    isExistingAccountError(created.error) ? 'This email already has an account. Use an invitation instead.' : 'Could not create the user.',
    isExistingAccountError(created.error) ? 409 : 500, { requestId });
  const newUserId = created.data.user.id;
  const rollback = async () => {
    const removed = await admin.auth.admin.deleteUser(newUserId);
    if (removed.error) logger.error('field member rollback failed', { organization_id: org.orgId, user_id: newUserId });
  };
  const membership = await admin.rpc('fn_accept_team_invite', {
    p_user: newUserId, p_org: org.orgId, p_role: role, p_invited_by: user.id,
    p_issued_at: new Date().toISOString(), p_invited_at: new Date().toISOString(),
    p_interface_settings: { preset: 'completa' },
  });
  if (membership.error || !membership.data?.id) {
    await rollback();
    return fail('internal_error', 'Could not activate the team member.', 500, { requestId });
  }
  try {
    await manageFieldSales(getRequestPool(), org.orgId, user.id, {
      operation: 'employee', user_id: newUserId, display_name: fullName, active: true,
    });
  } catch (error) {
    logger.error('field member enrollment failed', { organization_id: org.orgId,
      user_id: newUserId, error: error instanceof Error ? error.message : 'unknown' });
    await rollback();
    return fail('internal_error', 'Could not enroll the team member in Field Sales.', 500, { requestId });
  }
  await audit({ action: 'member.accepted', actorUserId: user.id, organizationId: org.orgId,
    resourceType: 'membership', resourceId: membership.data.id,
    metadata: { role, method: 'manager_created_field_worker', email_hash: hashEmail(email) }, requestId });
  return ok({ user_id: newUserId, role, display_name: fullName }, { status: 201, requestId });
}
