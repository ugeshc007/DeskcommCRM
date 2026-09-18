import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

// PSIDs são endereços da Página, não telefones nem identidades globais.
const pageScopedId = z.string().regex(/^[0-9]+$/);
const eventSchema = z.object({
  sender: z.object({ id: pageScopedId }),
  recipient: z.object({ id: pageScopedId }),
  timestamp: z.number().int().nonnegative().safe(),
  message: z.object({
    mid: z.string().min(1),
    text: z.string().optional(),
    is_echo: z.boolean().optional(),
    quick_reply: z.object({ payload: z.string().min(1) }).optional(),
    attachments: z.array(z.object({ type: z.string() })).optional(),
  }).optional(),
  postback: z.object({
    mid: z.string().min(1).optional(),
    title: z.string().optional(),
    payload: z.string().min(1),
  }).optional(),
});
const webhookSchema = z.object({
  object: z.literal('page'),
  entry: z.array(z.object({
    id: pageScopedId,
    messaging: z.array(eventSchema).optional(),
  })),
});

export type MessengerInbound = {
  pageId: string;
  senderId: string;
  externalId: string;
  timestamp: number;
  text: string | null;
  selection: string | null;
  attachmentTypes: string[];
};

/** A assinatura cobre os bytes originais, antes de qualquer parse JSON. */
export function verifyMessengerSignature(raw: Uint8Array, signature: string | null, appSecret: string): boolean {
  if (!appSecret || !signature || !/^sha256=[a-fA-F0-9]{64}$/.test(signature)) return false;
  const received = Buffer.from(signature.slice(7), 'hex');
  const expected = createHmac('sha256', appSecret).update(raw).digest();
  return timingSafeEqual(received, expected);
}

/** Chamador resolve a Página de uma conexão autorizada; nunca do payload. */
export function parseMessengerWebhook(raw: Uint8Array, signature: string | null, appSecret: string, expectedPageId: string): MessengerInbound[] {
  if (!pageScopedId.safeParse(expectedPageId).success) throw new Error('invalid_page_id');
  if (!verifyMessengerSignature(raw, signature, appSecret)) throw new Error('invalid_webhook_signature');
  let json: unknown;
  try { json = JSON.parse(Buffer.from(raw).toString('utf8')); }
  catch { throw new Error('invalid_webhook_payload'); }
  const parsed = webhookSchema.safeParse(json);
  if (!parsed.success) throw new Error('invalid_webhook_payload');
  const result: MessengerInbound[] = [];
  for (const entry of parsed.data.entry) {
    // Uma assinatura do app não autoriza acesso a outras Páginas/organizações.
    if (entry.id !== expectedPageId) throw new Error('webhook_page_mismatch');
    for (const event of entry.messaging ?? []) {
      if (event.message?.is_echo) continue;
      if (event.recipient.id !== expectedPageId) throw new Error('webhook_page_mismatch');
      if (event.sender.id === expectedPageId) continue;
      if (!event.message && !event.postback) continue; // delivery/read/typing não abrem conversa.
      if (event.message && event.postback) throw new Error('invalid_webhook_payload');
      const externalId = event.message?.mid ?? event.postback?.mid;
      // Sem identidade estável não é seguro reenfileirar uma ação de negócio.
      if (!externalId) throw new Error('webhook_message_id_missing');
      result.push({
        pageId: expectedPageId,
        senderId: event.sender.id,
        externalId,
        timestamp: event.timestamp,
        text: event.message?.text ?? event.postback?.title ?? null,
        selection: event.message?.quick_reply?.payload ?? event.postback?.payload ?? null,
        // URLs arbitrárias não atravessam este seam nem disparam downloads.
        attachmentTypes: event.message?.attachments?.map(attachment => attachment.type) ?? [],
      });
    }
  }
  return result;
}

/** Comparação de tokens sem diferenças de tempo dependentes do prefixo. */
export function verifyMessengerChallenge(mode: string | null, token: string | null, challenge: string | null, expectedToken: string): string | null {
  if (mode !== 'subscribe' || !token || !expectedToken || !challenge || !/^\d+$/.test(challenge)) return null;
  // HMAC normaliza o comprimento; não guarda nem devolve o token.
  const digest = (value: string) => createHmac('sha256', expectedToken).update(value).digest();
  return timingSafeEqual(digest(token), digest(expectedToken)) ? challenge : null;
}
