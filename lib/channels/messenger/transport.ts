import { z } from 'zod';
import { providerHttp } from '@/lib/integrations/provider-http';
import type { OutboundEnvelope } from '../types';
import { messengerOutboundPayload } from './outbound';

const connectionSchema = z.strictObject({
  organizationId: z.uuid(),
  pageId: z.string().regex(/^[0-9]+$/),
  token: z.string().min(1).refine(value => !/[\r\n]/.test(value)),
  graphVersion: z.string().regex(/^v[0-9]+\.[0-9]+$/),
  active: z.literal(true),
});
export type MessengerSendConnection = z.infer<typeof connectionSchema>;
export type MessengerConnectionResolver = (scope: {
  organizationId: string; pageId: string;
}) => Promise<MessengerSendConnection | null>;

/** Nunca contém o corpo/erro remoto, que pode repetir credenciais ou dados pessoais. */
export class MessengerDeliveryError extends Error {
  constructor(readonly outcome: 'rejected' | 'unknown', readonly code: string) {
    super(code);
    this.name = 'MessengerDeliveryError';
  }
}

/** Chamado apenas depois dos gates canônicos; não concede autorização por si só. */
export async function sendMessengerEnvelope(envelope: OutboundEnvelope, resolve: MessengerConnectionResolver): Promise<{ externalId: string }> {
  const payload = messengerOutboundPayload(envelope);
  // Contrato escopado obrigatório: nenhuma credencial global/fallback de ambiente.
  const raw = await resolve({ organizationId: envelope.organizationId, pageId: envelope.sessionRef });
  const result = connectionSchema.safeParse(raw);
  if (!result.success || result.data.organizationId !== envelope.organizationId || result.data.pageId !== envelope.sessionRef)
    throw new MessengerDeliveryError('rejected', 'messenger_connection_unavailable');
  const connection = result.data;
  await envelope.beforeSend?.();
  let response: Awaited<ReturnType<typeof providerHttp>>;
  try {
    response = await providerHttp(
      `https://graph.facebook.com/${connection.graphVersion}/${connection.pageId}/messages`,
      'POST', { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' },
      JSON.stringify(payload),
    );
  } catch {
    // Timeout pode ter acontecido DEPOIS da entrega. Não há retry neste transporte.
    throw new MessengerDeliveryError('unknown', 'messenger_delivery_uncertain');
  }
  if (response.status >= 400 && response.status < 500)
    throw new MessengerDeliveryError('rejected', 'messenger_send_rejected');
  if (response.status < 200 || response.status >= 300)
    throw new MessengerDeliveryError('unknown', 'messenger_delivery_uncertain');
  const received = z.object({ recipient_id: z.string(), message_id: z.string().min(1) }).safeParse(response.data);
  if (!received.success || received.data.recipient_id !== envelope.to)
    throw new MessengerDeliveryError('unknown', 'messenger_response_invalid');
  return { externalId: received.data.message_id };
}
