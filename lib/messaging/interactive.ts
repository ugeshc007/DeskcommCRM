import { z } from 'zod';

// Contrato neutro: persistido junto ao texto, nunca inferido de labels recebidos.
const choiceId = z.string().regex(/^[A-Za-z0-9_-]{1,60}$/);
const button = z.strictObject({ id: choiceId, title: z.string().trim().min(1).max(20) });
const row = z.strictObject({
  id: choiceId,
  title: z.string().trim().min(1).max(24),
  description: z.string().max(72).optional(),
});
export const interactiveMessageSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('buttons'), choices: z.array(button).min(1).max(3) }),
  z.strictObject({
    kind: z.literal('list'), button_label: z.string().trim().min(1).max(20),
    sections: z.array(z.strictObject({
      title: z.string().trim().min(1).max(24), rows: z.array(row).min(1).max(10),
    })).min(1).max(10),
  }),
]).superRefine((value, ctx) => {
  const choices = value.kind === 'buttons' ? value.choices : value.sections.flatMap(s => s.rows);
  if (choices.length > 10) ctx.addIssue({ code: 'custom', message: 'At most 10 list choices are allowed.' });
  if (new Set(choices.map(c => c.id)).size !== choices.length)
    ctx.addIssue({ code: 'custom', message: 'Choice IDs must be unique.' });
  if (new Set(choices.map(c => c.title)).size !== choices.length)
    ctx.addIssue({ code: 'custom', message: 'Choice labels must be unique.' });
});
export type InteractiveMessage = z.infer<typeof interactiveMessageSchema>;
