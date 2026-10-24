import { describe, expect, it } from 'vitest';
import { renderSessionText } from './render-session-text';

describe('session message rendering', () => {
  it('renders explicitly selected values including zero and false', () => {
    expect(renderSessionText('Hi {{session.name}}: {{session.total}} / {{session.ready}}', {
      name: { type: 'string', value: 'Customer' }, total: { type: 'number', value: 0 }, ready: { type: 'boolean', value: false },
    }, 4000)).toBe('Hi Customer: 0 / false');
  });
  it('never recursively evaluates customer text', () => {
    expect(renderSessionText('{{session.name}}', { name: { type: 'string', value: '{{session.token}}' } }, 4000)).toBe('{{session.token}}');
  });
  it('does not resolve other namespaces or ambient values', () => {
    expect(renderSessionText('{{env.token}} {{contact.name}}', {}, 4000)).toBe('{{env.token}} {{contact.name}}');
  });
  it.each(['missing', 'constructor', '__proto__', 'token', 'nested.key'])('fails closed for %s', key => {
    expect(() => renderSessionText(`Hello {{session.${key}}}`, {}, 4000)).toThrow('session_message_variable_missing');
  });
  it('bounds expanded text without silently truncating it', () => {
    expect(() => renderSessionText('{{session.name}}!', { name: { type: 'string', value: 'long' } }, 4)).toThrow('session_message_too_long');
  });
  it('does not expose an internal file reference as message content', () => {
    expect(() => renderSessionText('{{session.file}}', { file: { type: 'string', value: 'attachment:123' } }, 4000)).toThrow('session_message_attachment_reference');
  });
});
