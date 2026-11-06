import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { loadConnection, readConnectionCredential } from '@/lib/integrations/management';
import { messengerCredentialSchema, MESSENGER_CONNECTION_PROVIDER } from './connection';

export const pageSessionSchema = z.object({
  id: z.uuid(), organization_id: z.uuid(), integration_connection_id: z.uuid(),
  credential_revision: z.number().int().positive(), provider_account_id: z.string().regex(/^[0-9]{1,64}$/),
  status: z.string(), webhook_path_token: z.string(), webhook_verified_at: z.string().nullable(),
  webhook_received_at: z.string().nullable(),
});
export const PAGE_SESSION_COLUMNS = 'id,organization_id,integration_connection_id,credential_revision,provider_account_id,status,webhook_path_token,webhook_verified_at,webhook_received_at';

/** Leitura escopada + revisão atual: rotação nunca reutiliza o snapshot anterior. */
export async function credentialForPage(db: SupabaseClient, session: z.infer<typeof pageSessionSchema>) {
  const c = await loadConnection(db, session.organization_id, session.integration_connection_id);
  if (!c?.active || c.provider !== MESSENGER_CONNECTION_PROVIDER || c.revision !== session.credential_revision) return null;
  const credential = messengerCredentialSchema.parse(JSON.parse(await readConnectionCredential(db, session.organization_id, c)));
  if (credential.page_id !== session.provider_account_id) return null;
  const current = await loadConnection(db, session.organization_id, c.id);
  if (!current?.active || current.revision !== c.revision) return null;
  return credential;
}

export async function resolveBoundPage(db: SupabaseClient, organizationId: string, pageId: string, healthCheck = false) {
  const result = await db.from('channel_sessions').select(PAGE_SESSION_COLUMNS)
    .eq('organization_id', organizationId).eq('provider', MESSENGER_CONNECTION_PROVIDER)
    .eq('provider_account_id', pageId).in('status', healthCheck ? ['STARTING', 'WORKING', 'FAILED'] : ['WORKING']).is('archived_at', null).maybeSingle();
  if (result.error) throw new Error('page_connection_unavailable');
  if (!result.data) return null;
  const session = pageSessionSchema.parse(result.data);
  const credential = await credentialForPage(db, session);
  return credential ? { session, credential } : null;
}
