import { z } from 'zod';
import { isMediaPathOwnedBy } from '@/lib/messaging/media/upload-validation';

const attachment = z.object({
  id: z.uuid(), organization_id: z.string(), conversation_id: z.string(), contact_id: z.string(),
  direction: z.literal('inbound'), type: z.enum(['image', 'video', 'audio', 'document']),
  media_storage_path: z.string().nullable(), media_url: z.string().nullable(),
});

/** Referência à mensagem autenticada, não prova de antivírus ou do conteúdo. */
export function attachmentAnswerId(raw: unknown, scope: { organization_id: string; conversation_id: string | null; contact_id: string }): string | null {
  const parsed = attachment.safeParse(raw);
  if (!parsed.success) return null;
  const row = parsed.data;
  if (row.organization_id !== scope.organization_id || row.conversation_id !== scope.conversation_id || row.contact_id !== scope.contact_id) return null;
  if (row.media_storage_path) return isMediaPathOwnedBy(row.media_storage_path, row.organization_id, row.conversation_id) ? row.id : null;
  // Ponteiro de mídia veio da ingestão assinada. A rota existente de download
  // revalida posse e transporte; o construtor nunca baixa a URL fornecida aqui.
  return row.media_url?.trim() ? row.id : null;
}
export const ATTACHMENT_ANSWER_COLUMNS = 'id,organization_id,conversation_id,contact_id,direction,type,media_storage_path,media_url';
