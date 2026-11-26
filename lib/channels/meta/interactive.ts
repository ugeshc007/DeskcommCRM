import { interactiveMessageSchema, type InteractiveMessage } from '@/lib/messaging/interactive';

/** Tradução apenas; autorização e janela continuam no sink canônico. */
export function metaInteractivePayload(body: string, raw: InteractiveMessage) {
  const value = interactiveMessageSchema.parse(raw);
  if (!body.trim() || body.length > 1024) throw new Error('interactive_body_invalid');
  return {
    type: 'interactive',
    interactive: {
      type: value.kind === 'buttons' ? 'button' : 'list',
      body: { text: body },
      action: value.kind === 'buttons'
        ? { buttons: value.choices.map(reply => ({ type: 'reply', reply })) }
        : { button: value.button_label, sections: value.sections },
    },
  };
}

/** Nunca usa título como identidade; contexto preserva a mensagem respondida. */
export function parseMetaSelection(raw: Record<string, unknown>) {
  if (raw.type !== 'interactive' || !raw.interactive || typeof raw.interactive !== 'object') return null;
  const interactive = raw.interactive as Record<string, unknown>;
  if (interactive.type !== 'button_reply' && interactive.type !== 'list_reply') return null;
  const reply = interactive[interactive.type];
  if (!reply || typeof reply !== 'object') return null;
  const { id, title } = reply as Record<string, unknown>;
  if (typeof id !== 'string' || id.length === 0 || id.length > 256 || typeof title !== 'string' || title.length > 200) return null;
  const context = raw.context && typeof raw.context === 'object' ? raw.context as Record<string, unknown> : {};
  return { id, title, reply_to_external_id: typeof context.id === 'string' ? context.id : null };
}
