import { z } from 'zod';
import { interactiveMessageSchema } from '@/lib/messaging/interactive';

const selectionSchema = z.object({ interactive_selection: z.object({
  id: z.string(), reply_to_external_id: z.string(),
}) });
const promptSchema = z.object({ interactive: interactiveMessageSchema });

/** Consultas já limitaram organização, conversa, enrollment e última pergunta. */
export function choiceForPrompt(inboundMetadata: unknown, prompt: { external_id: string | null; metadata: unknown } | null): string | null {
  const reply = selectionSchema.safeParse(inboundMetadata);
  const message = promptSchema.safeParse(prompt?.metadata);
  if (!reply.success || !message.success || !prompt?.external_id ||
      reply.data.interactive_selection.reply_to_external_id !== prompt.external_id) return null;
  const choices = message.data.interactive.kind === 'buttons' ? message.data.interactive.choices
    : message.data.interactive.sections.flatMap(s => s.rows);
  const id = reply.data.interactive_selection.id;
  return choices.some(choice => choice.id === id) ? id : null;
}
