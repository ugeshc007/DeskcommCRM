import { describe, expect, it } from 'vitest';
import { interactiveMessageSchema } from '@/lib/messaging/interactive';
import { metaInteractivePayload, parseMetaSelection } from '@/lib/channels/meta/interactive';
import { supportsInteractiveChoices } from '@/lib/channels/capabilities';
import { sendMessageSchema } from '@/lib/schemas/messaging';
import { choiceForPrompt } from '@/lib/followup/choice-reply';

const menu = { kind: 'buttons' as const, choices: [{ id: 'products', title: 'Products' }] };
describe('native choice contract', () => {
  it('translates into native buttons, not text or approved templates', () => {
    expect(metaInteractivePayload('Choose', menu)).toEqual({ type: 'interactive', interactive: {
      type: 'button', body: { text: 'Choose' }, action: { buttons: [{ type: 'reply', reply: menu.choices[0] }] },
    } });
  });
  it('limits and deduplicates choices', () => {
    expect(interactiveMessageSchema.safeParse({ ...menu, choices: [...menu.choices, ...menu.choices] }).success).toBe(false);
    expect(interactiveMessageSchema.safeParse({ ...menu, choices: Array.from({ length: 4 }, (_, i) => ({ id: `id${i}`, title: `Choice ${i}` })) }).success).toBe(false);
    expect(interactiveMessageSchema.safeParse({ kind: 'list', button_label: 'Choose', sections: Array.from({ length: 2 }, (_, i) => ({ title: `Section ${i}`, rows: Array.from({ length: 6 }, (_, j) => ({ id: `id${i}${j}`, title: `Row ${i}${j}` })) })) }).success).toBe(false);
  });
  it('refuses empty/oversized bodies and mixed media', () => {
    expect(() => metaInteractivePayload('a'.repeat(1025), menu)).toThrow('interactive_body_invalid');
    const valid = { conversation_id: '00000000-0000-4000-8000-000000000001', type: 'text', body: 'Choose', interactive: menu };
    expect(sendMessageSchema.safeParse(valid).success).toBe(true);
    expect(sendMessageSchema.safeParse({ ...valid, type: 'image' }).success).toBe(false);
    expect(sendMessageSchema.safeParse({ ...valid, media_url: 'https://example.test/a.jpg' }).success).toBe(false);
  });
  it('preserves stable ID and context, never trusts a title for routing', () => {
    const selection = parseMetaSelection({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'products', title: 'Renamed' } }, context: { id: 'current-message' } });
    expect(selection).toEqual({ id: 'products', title: 'Renamed', reply_to_external_id: 'current-message' });
    expect(choiceForPrompt({ interactive_selection: selection }, { external_id: 'current-message', metadata: { interactive: menu } })).toBe('products');
    expect(choiceForPrompt({ interactive_selection: selection }, { external_id: 'newer-message', metadata: { interactive: menu } })).toBeNull();
    expect(choiceForPrompt({ interactive_selection: { ...selection, id: 'not-offered' } }, { external_id: 'current-message', metadata: { interactive: menu } })).toBeNull();
    expect(choiceForPrompt({ body: 'Products' }, { external_id: 'current-message', metadata: { interactive: menu } })).toBeNull();
  });
  it('fails closed for unsupported and unknown transports', () => {
    expect(supportsInteractiveChoices('meta_cloud')).toBe(true);
    for (const provider of ['waha', 'zernio', 'unknown', '__proto__', undefined]) expect(supportsInteractiveChoices(provider)).toBe(false);
  });
});
