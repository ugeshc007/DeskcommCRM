import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { createAdminClient } from '@/lib/supabase/admin';
import { ok, fail } from '@/lib/api/wrappers';
import { audit } from '@/lib/audit';
import { env } from '@/lib/env';
import { loadConnection, readConnectionCredential } from '@/lib/integrations/management';
import { messengerCredentialSchema, MESSENGER_CONNECTION_PROVIDER } from '@/lib/channels/messenger/connection';
import { PAGE_SESSION_COLUMNS, pageSessionSchema } from '@/lib/channels/messenger/binding';
import { integrationError, readIntegrationJson } from '../../_shared';

type Context = { params: Promise<{ id: string }> };
const inputSchema = z.strictObject({ revision: z.number().int().positive() });

async function channelView(db: SupabaseClient, organizationId: string, connectionId: string) {
  const { data, error } = await db.from('channel_sessions').select(PAGE_SESSION_COLUMNS)
    .eq('organization_id', organizationId).eq('integration_connection_id', connectionId)
    .eq('provider', MESSENGER_CONNECTION_PROVIDER).is('archived_at', null).maybeSingle();
  if (error) throw new Error('integration_storage_unavailable');
  if (!data) return null;
  const session = pageSessionSchema.parse(data);
  return {
    id: session.id, status: session.status, revision: session.credential_revision,
    callback_url: new URL('/api/v1/webhooks/page/' + session.webhook_path_token, env.NEXT_PUBLIC_APP_URL).toString(),
    verified_at: session.webhook_verified_at, received_at: session.webhook_received_at,
  };
}

export async function GET(_req: Request, context: Context) {
  const auth = await requireRole('admin'); if (!auth.ok) return auth.response;
  try {
    const id = z.uuid().parse((await context.params).id);
    const db = createAdminClient();
    const connection = await loadConnection(db, auth.org.orgId, id);
    if (!connection || connection.provider !== MESSENGER_CONNECTION_PROVIDER) return fail('not_found', 'Connection not found.', 404);
    return ok(await channelView(db, auth.org.orgId, id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return integrationError(error); }
}

export async function POST(req: Request, context: Context) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const auth = await requireRole('admin'); if (!auth.ok) return auth.response;
  try {
    const id = z.uuid().parse((await context.params).id);
    const input = inputSchema.parse(await readIntegrationJson(req));
    const db: SupabaseClient = createAdminClient();
    const connection = await loadConnection(db, auth.org.orgId, id);
    if (!connection || connection.provider !== MESSENGER_CONNECTION_PROVIDER) return fail('not_found', 'Connection not found.', 404);
    if (!connection.active || connection.revision !== input.revision) return fail('conflict', 'Test the current credentials before activating this channel.', 409);
    // Page ID vem exclusivamente do cofre pertencente a esta organização.
    const credential = messengerCredentialSchema.parse(JSON.parse(await readConnectionCredential(db, auth.org.orgId, connection)));
    const result = await db.rpc('fn_bind_page_channel', {
      p_org: auth.org.orgId, p_actor: auth.user.id, p_connection: id,
      p_revision: input.revision, p_page: credential.page_id,
    });
    if (result.error) {
      if (result.error.code === '23505') return fail('conflict', 'This Page is already bound. Ask the installation administrator to review its ownership.', 409);
      throw new Error(result.error.code === '40001' ? 'integration_conflict' : result.error.code === '42501' ? 'integration_forbidden' : 'integration_storage_unavailable');
    }
    await audit({ action: 'channel.reactivated', actorUserId: auth.user.id, organizationId: auth.org.orgId,
      resourceType: 'channel_session', resourceId: z.uuid().parse(result.data), metadata: { revision: input.revision } });
    return ok(await channelView(db, auth.org.orgId, id), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return integrationError(error); }
}
