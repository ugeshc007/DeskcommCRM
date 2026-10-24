import { createAdminClient } from '@/lib/supabase/admin';
import type { ChannelAdapter } from '../types';
import { sendMessengerEnvelope } from '../messenger/transport';
import { resolveBoundPage } from '../messenger/binding';
import { providerHttp } from '@/lib/integrations/provider-http';
import { fetchPageMedia } from '../messenger/media';

export const messengerAdapter: ChannelAdapter = {
  provider: 'messenger',
  resolveRecipient(input) {
    return !input.isGroup && /^[0-9]{1,64}$/.test(input.providerConversationId ?? '')
      ? input.providerConversationId! : null;
  },
  // Configuração é por sessão e verificada em send; não há token global.
  isConfigured: () => true,
  async fetchInboundMedia(input) {
    const bound = await resolveBoundPage(createAdminClient(), input.organizationId, input.sessionRef);
    if (!bound) throw new Error('page_connection_unavailable');
    return fetchPageMedia(input.url);
  },
  codes: { notConfigured: 'page_connection_unavailable', sendFailed: 'page_send_rejected', unknownError: 'page_delivery_uncertain' },
  async checkHealth(input) {
    try {
      const bound = await resolveBoundPage(createAdminClient(), input.organizationId, input.sessionRef, true);
      if (!bound) return { reachable: false, status: null, detail: 'page_connection_unavailable' };
      const { credential } = bound;
      const result = await providerHttp(`https://graph.facebook.com/${credential.graph_version}/me?fields=id`, 'GET', { Authorization: `Bearer ${credential.token}` });
      if (result.status >= 400 && result.status < 500) return { reachable: true, status: 'FAILED', detail: 'page_credentials_rejected' };
      if (result.status !== 200) return { reachable: false, status: null, detail: 'page_service_unavailable' };
      if (!result.data || typeof result.data !== 'object' || !('id' in result.data) || result.data.id !== credential.page_id)
        return { reachable: true, status: 'FAILED', detail: 'page_identity_mismatch' };
      // Token válido não prova entrega de mensagens ao webhook desta instalação.
      return bound.session.webhook_received_at
        ? { reachable: true, status: 'WORKING', detail: null }
        : { reachable: true, status: 'STARTING', detail: 'page_awaiting_first_message' };
    } catch { return { reachable: false, status: null, detail: 'page_service_unavailable' }; }
  },
  async send(envelope) {
    return sendMessengerEnvelope(envelope, async scope => {
      const bound = await resolveBoundPage(createAdminClient(), scope.organizationId, scope.pageId);
      return bound ? { organizationId: scope.organizationId, pageId: scope.pageId,
        token: bound.credential.token, graphVersion: bound.credential.graph_version, active: true } : null;
    });
  },
};
