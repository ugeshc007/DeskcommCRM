import { z } from 'zod';
import type { EventHandler } from '@/lib/event-log/dispatcher';
import { createAdminClient } from '@/lib/supabase/admin';
import { aplicarEfeitosPosEntrada } from '@/lib/channels/pos-entrada';

export const inboundPostprocessHandler: EventHandler = {
  key: 'inbound_postprocess.v1', events: ['channel.inbound_postprocess'],
  async handle(row) {
    const key = 'inbound_postprocess.v1';
    const id = z.uuid().safeParse(row.entity_id);
    if (!id.success) return { consumer_key: key, status: 'error', detail: 'invalid_message_identity' };
    const db = createAdminClient();
    const { data: m, error } = await db.from('messages').select('id,contact_id,conversation_id,channel_session_id,body,direction')
      .eq('organization_id', row.organization_id).eq('id', id.data).maybeSingle();
    if (error) return { consumer_key: key, status: 'error', detail: 'message_read_failed' };
    if (!m || m.direction !== 'inbound') return { consumer_key: key, status: 'skipped', detail: 'message_unavailable' };
    const { data: contact, error: contactError } = await db.from('contacts').select('is_anonymized').eq('organization_id', row.organization_id).eq('id', m.contact_id).maybeSingle();
    if (contactError) return { consumer_key: key, status: 'error', detail: 'contact_read_failed' };
    if (!contact || contact.is_anonymized) return { consumer_key: key, status: 'skipped', detail: 'contact_unavailable' };
    try {
      await aplicarEfeitosPosEntrada(db, { organizationId: row.organization_id, contactId: m.contact_id,
        conversationId: m.conversation_id, channelSessionId: m.channel_session_id, messageId: m.id,
        texto: m.body, nomeDoContato: null, origem: 'durable_inbound', durable: true });
      return { consumer_key: key, status: 'ok' };
    } catch { return { consumer_key: key, status: 'error', detail: 'inbound_postprocess_retry' }; }
  },
};
