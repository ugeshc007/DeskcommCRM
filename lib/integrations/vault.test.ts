import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/env', () => ({ env: { AI_CRED_AES_KEY: Buffer.alloc(32, 7).toString('base64') } }));
import { openCredential, sealCredential } from './vault';
import { encryptKey, decryptKey } from '@/lib/crypto/aes_gcm';

const identity = { organizationId: '11111111-1111-4111-8111-111111111111', connectionId: '22222222-2222-4222-8222-222222222222', revision: 1 };
describe('integration credential authenticated context', () => {
  it('round trips without exporting a secret suffix', () => {
    const sealed = sealCredential(identity, 'synthetic-credential');
    expect(Object.keys(sealed).sort()).toEqual(['ciphertext', 'iv', 'tag']);
    expect(openCredential(identity, sealed)).toBe('synthetic-credential');
  });
  it.each([{ organizationId: '33333333-3333-4333-8333-333333333333' }, { connectionId: '33333333-3333-4333-8333-333333333333' }, { revision: 2 }])('rejects transplanted credentials %j', change => {
    expect(() => openCredential({ ...identity, ...change }, sealCredential(identity, 'synthetic'))).toThrow('integration_credential_unavailable');
  });
  it('rejects tampering', () => {
    const sealed = sealCredential(identity, 'synthetic');
    const firstByte = sealed.ciphertext[0];
    if (firstByte === undefined) throw new Error('Expected encrypted bytes');
    sealed.ciphertext[0] = firstByte ^ 1;
    expect(() => openCredential(identity, sealed)).toThrow('integration_credential_unavailable');
  });
  it('preserves existing credentials without authenticated context', () => {
    expect(decryptKey(encryptKey('synthetic-legacy'))).toBe('synthetic-legacy');
  });
  it('rejects empty and oversized credentials', () => {
    expect(() => sealCredential(identity, '')).toThrow('integration_invalid_credential');
    expect(() => sealCredential(identity, 'x'.repeat(65537))).toThrow('integration_invalid_credential');
  });
});
