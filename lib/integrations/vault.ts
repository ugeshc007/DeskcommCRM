import { z } from 'zod';
import { encryptKey, decryptKey } from '@/lib/crypto/aes_gcm';

const identitySchema = z.strictObject({ organizationId: z.uuid(), connectionId: z.uuid(), revision: z.number().int().positive() });
export type CredentialIdentity = z.infer<typeof identitySchema>;
export interface SealedCredential { ciphertext: Buffer; iv: Buffer; tag: Buffer }

function context(identity: CredentialIdentity): Buffer {
  const parsed = identitySchema.parse(identity);
  return Buffer.from(JSON.stringify(['integration-credential-v1', parsed.organizationId, parsed.connectionId, parsed.revision]));
}

/** AAD impede transplantar ciphertext entre organizações, conexões ou revisões.
 * Sem last4: nem fragmentos do segredo são metadados públicos desta conexão.
 */
export function sealCredential(identity: CredentialIdentity, credential: string): SealedCredential {
  if (!credential || Buffer.byteLength(credential) > 65536) throw new Error('integration_invalid_credential');
  const { ciphertext, iv, tag } = encryptKey(credential, context(identity));
  return { ciphertext, iv, tag };
}

export function openCredential(identity: CredentialIdentity, sealed: SealedCredential): string {
  try { return decryptKey(sealed, context(identity)); }
  catch { throw new Error('integration_credential_unavailable'); }
}
