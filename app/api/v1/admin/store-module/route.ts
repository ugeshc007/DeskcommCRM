import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/auth/requirePlatformAdmin';
import { loadAuthUser, mfaEmDivida } from '@/lib/auth/server';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { ok, fail } from '@/lib/api/wrappers';
import { readIntegrationJson } from '../../integration-connections/_shared';
import { requireSupportWrite } from '@/lib/impersonate/support';

export async function POST(req: Request) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  let auth: Awaited<ReturnType<typeof requirePlatformAdmin>>;
  try { auth = await requirePlatformAdmin(); } catch { return fail('forbidden', 'Platform administrator access is required.', 403); }
  if (auth.platformAdmin.scope !== 'full' || (await loadAuthUser())?.support) return fail('forbidden', 'Use a full platform administrator session outside support mode.', 403);
  if (await mfaEmDivida()) return fail('mfa_required', 'Confirm two-step verification.', 403);
  try {
    z.strictObject({ operation: z.literal('install') }).parse(await readIntegrationJson(req));
    const db = await getRequestPool().connect();
    try {
      await db.query('begin'); await db.query("set local lock_timeout='5s'"); await db.query("set local statement_timeout='30s'");
      const actor = await db.query("select user_id from public.platform_admins where user_id=$1 and scope='full' and revoked_at is null for share", [auth.user.id]);
      if (!actor.rowCount) throw new Error('forbidden');
      await db.query('select fn_provision_checkout_module()');
      await db.query("insert into public.api_audit_log(actor_user_id,action,resource_type,metadata,bypassed_rls,acting_as_platform_admin) values($1,'store.module_installed','store_module','{\"version\":1}',true,true)", [auth.user.id]);
      await db.query('commit'); return ok({ installed: true, organizations_activated: 0 });
    } catch (error) { await db.query('rollback'); throw error; }
    finally { db.release(); }
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return fail('validation_failed', 'Confirm module installation.', 422);
    return fail('service_unavailable', 'Module installation could not be confirmed. Existing store data is preserved.', 503);
  }
}
