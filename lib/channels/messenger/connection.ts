import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadConnection, readConnectionCredential } from '@/lib/integrations/management';
import { providerHttp } from '@/lib/integrations/provider-http';
import type { MessengerSendConnection } from './transport';

import { MESSENGER_CONNECTION_PROVIDER } from './public-config';
export { MESSENGER_CONNECTION_PROVIDER } from './public-config';
export const messengerCredentialSchema = z.strictObject({
  page_id: z.string().regex(/^[0-9]+$/).max(64),
  token: z.string().min(1).max(16000).regex(/^[^\r\n]+$/),
  app_secret: z.string().regex(/^[a-fA-F0-9]{32}$/),
  verify_token: z.string().min(16).max(256).regex(/^[A-Za-z0-9_-]+$/),
  graph_version: z.string().regex(/^v[0-9]+\.[0-9]+$/),
});

/** /me prova que o bearer identifica a Página configurada, não apenas um usuário. */
export async function testMessengerCredential(credential: string): Promise<boolean> {
  try {
    const c = messengerCredentialSchema.parse(JSON.parse(credential));
    const result = await providerHttp(`https://graph.facebook.com/${c.graph_version}/me?fields=id`, 'GET', { Authorization: `Bearer ${c.token}` });
    const identity = z.object({ id: z.string() }).safeParse(result.data);
    return result.status === 200 && identity.success && identity.data.id === c.page_id;
  } catch { return false; }
}

/** Só o vínculo de canal validado no banco pode fornecer connectionId ao runtime. */
export async function resolveMessengerConnection(db: SupabaseClient, scope: {
  organizationId: string; connectionId: string; pageId: string;
}): Promise<MessengerSendConnection | null> {
  z.uuid().parse(scope.organizationId); z.uuid().parse(scope.connectionId);
  const connection = await loadConnection(db, scope.organizationId, scope.connectionId);
  if (!connection || connection.provider !== MESSENGER_CONNECTION_PROVIDER || !connection.active) return null;
  const raw = await readConnectionCredential(db, scope.organizationId, connection);
  const parsed = messengerCredentialSchema.safeParse(JSON.parse(raw));
  if (!parsed.success || parsed.data.page_id !== scope.pageId) return null;
  // Releitura depois de decifrar: rotação/desconexão invalida o snapshot.
  const current = await loadConnection(db, scope.organizationId, scope.connectionId);
  if (!current?.active || current.revision !== connection.revision || current.provider !== connection.provider) return null;
  return { organizationId: scope.organizationId, pageId: scope.pageId,
    token: parsed.data.token, graphVersion: parsed.data.graph_version, active: true };
}
