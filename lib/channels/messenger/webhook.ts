import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { credentialForPage, PAGE_SESSION_COLUMNS, pageSessionSchema } from './binding';
import { parseMessengerWebhook, verifyMessengerChallenge } from './protocol';
import { createHash } from 'node:crypto';
import { ehPedidoDeOptOut } from '@/lib/opt-out/deteccao';
import { assertPageMediaUrl } from './media';
import type { createAdminClient } from '@/lib/supabase/admin';

export async function loadPageEndpoint(db: SupabaseClient, token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const result = await db.from('channel_sessions').select(PAGE_SESSION_COLUMNS)
    .eq('webhook_path_token', token).eq('provider', 'messenger').is('archived_at', null).maybeSingle();
  if (result.error) throw new Error('page_storage_unavailable');
  if (!result.data) return null;
  const session = pageSessionSchema.parse(result.data);
  const credential = await credentialForPage(db, session);
  return credential ? { session, credential } : null;
}
export async function pageChallenge(db: SupabaseClient, token: string, url: URL) {
  const endpoint = await loadPageEndpoint(db, token);
  if (!endpoint) return null;
  const challenge = verifyMessengerChallenge(url.searchParams.get('hub.mode'), url.searchParams.get('hub.verify_token'), url.searchParams.get('hub.challenge'), endpoint.credential.verify_token);
  if (!challenge) return null;
  const { error } = await db.from('channel_sessions').update({ webhook_verified_at: new Date().toISOString() })
    .eq('organization_id', endpoint.session.organization_id).eq('id', endpoint.session.id).eq('credential_revision', endpoint.session.credential_revision);
  if (error) throw new Error('page_storage_unavailable');
  return challenge;
}

const receiptSchema = z.object({ contact_id: z.uuid(), conversation_id: z.uuid(), message_id: z.uuid(), duplicate: z.boolean() });
export async function ingestPageWebhook(db: ReturnType<typeof createAdminClient>, token: string, raw: Uint8Array, signature: string | null) {
  const endpoint = await loadPageEndpoint(db, token);
  if (!endpoint) throw new Error('page_endpoint_unavailable');
  const { session, credential } = endpoint;
  const events = parseMessengerWebhook(raw, signature, credential.app_secret, session.provider_account_id);
  let inserted = 0;
  for (const event of events) {
    // Anexo não suportado fica VISÍVEL ao atendente; não inventa conteúdo do arquivo.
    const text = event.text ?? (event.attachmentTypes.length ? '[Customer sent an attachment; ask them to describe it.]' : event.selection);
    const parts = event.attachments.length ? event.attachments : [null];
    for (const [index, attachment] of parts.entries()) {
    // Uma linha por anexo: cada um usa a persistência/derivação canônica.
    if (attachment) assertPageMediaUrl(attachment.url);
    const external = attachment ? createHash('sha256').update(event.externalId + ':attachment:' + index).digest('hex') : event.externalId;
    const { data, error } = await (db as SupabaseClient).rpc('fn_ingest_page_message_v3', {
      p_org: session.organization_id, p_session: session.id, p_revision: session.credential_revision,
      p_sender: event.senderId, p_external: external, p_at: new Date(event.timestamp).toISOString(), p_text: index === 0 ? text : null, p_selection: event.selection,
      p_media: attachment, p_opt_out: ehPedidoDeOptOut(event.text),
    });
    if (error) throw new Error('page_storage_unavailable');
    if (data && typeof data === 'object' && data.ignored === true) continue;
    const receipt = receiptSchema.parse(data);
    if (!receipt.duplicate) {
      inserted++;
    }
    }
  }
  return { received: events.length, inserted };
}
