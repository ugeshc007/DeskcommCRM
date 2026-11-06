import { describe, expect, it } from 'vitest';
import { attachmentAnswerId } from './attachment-answer';
import { validateAnswer } from './answer-validation';

const scope = { organization_id: 'org-a', conversation_id: 'conversation-a', contact_id: 'contact-a' };
const id = '00000000-0000-4000-8000-000000000004';
const attachment = { ...scope, id, direction: 'inbound', type: 'document', media_storage_path: 'org-a/conversation-a/document.pdf', media_url: null };
describe('file answers', () => {
  it('keeps only an authenticated attachment reference', () => {
    expect(attachmentAnswerId(attachment, scope)).toBe(id);
    expect(validateAnswer('file', '', id)).toEqual({ valid: true, value: `attachment:${id}` });
  });
  it('never interprets text, paths or pasted URLs as uploaded files', () => {
    for (const text of [id, `attachment:${id}`, 'https://example.test/file.pdf', 'org-a/conversation-a/file'])
      expect(validateAnswer('file', text)).toEqual({ valid: false });
    expect(attachmentAnswerId({ ...attachment, type: 'text', body: 'https://example.test/file.pdf' }, scope)).toBeNull();
  });
  it('rejects cross-tenant, contact, conversation and storage references', () => {
    for (const patch of [{ organization_id: 'org-b' }, { contact_id: 'contact-b' }, { conversation_id: 'conversation-b' }, { media_storage_path: 'org-b/conversation-a/file.pdf' }])
      expect(attachmentAnswerId({ ...attachment, ...patch }, scope)).toBeNull();
  });
  it('does not accept outbound messages or rows with no media reference', () => {
    expect(attachmentAnswerId({ ...attachment, direction: 'outbound' }, scope)).toBeNull();
    expect(attachmentAnswerId({ ...attachment, media_storage_path: null }, scope)).toBeNull();
  });
});
