import { assertSafeOutboundUrl } from '@/lib/automation/outbound-url';
import type { OutboundEnvelope } from '../types';

/** Somente tradução. Janela, consentimento e posse devem passar pelo sink canônico. */
export function messengerOutboundPayload(envelope: OutboundEnvelope) {
  if (!/^[0-9]+$/.test(envelope.sessionRef) || !/^[0-9]+$/.test(envelope.to))
    throw new Error('messenger_address_invalid');
  if (!envelope.providerConversationId || envelope.providerConversationId !== envelope.to)
    throw new Error('messenger_thread_mismatch');
  // Não fingir que listas/templates do canal oficial são mensagens desta plataforma.
  if (envelope.interactive || envelope.contact || envelope.replyToExternalId)
    throw new Error('messenger_message_unsupported');
  if (envelope.kind === 'text') {
    if (!envelope.body?.trim() || envelope.media) throw new Error('messenger_message_invalid');
    return {
      recipient: { id: envelope.to }, messaging_type: 'RESPONSE' as const,
      message: { text: envelope.body },
    };
  }
  const types = { image: 'image', video: 'video', audio: 'audio', document: 'file' } as const;
  if (!(envelope.kind in types) || !envelope.media) throw new Error('messenger_message_unsupported');
  // Anexo com legenda não tem a semântica de um envio simples. Não descartar texto
  // nem emitir dois sends sem duas identidades idempotentes no chamador.
  if (envelope.body?.trim() || envelope.media.caption?.trim()) throw new Error('messenger_caption_unsupported');
  assertSafeOutboundUrl(envelope.media.url);
  const mediaUrl = new URL(envelope.media.url);
  if (mediaUrl.protocol !== 'https:' || mediaUrl.username || mediaUrl.password || mediaUrl.hash)
    throw new Error('messenger_media_url_invalid');
  return {
    recipient: { id: envelope.to }, messaging_type: 'RESPONSE' as const,
    message: { attachment: {
      type: types[envelope.kind as keyof typeof types],
      payload: { url: mediaUrl.toString(), is_reusable: false },
    } },
  };
}
