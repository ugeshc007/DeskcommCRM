// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConnection, readConnectionCredential } from '@/lib/integrations/management';
import { providerHttp } from '@/lib/integrations/provider-http';
import { messengerCredentialSchema, resolveMessengerConnection, testMessengerCredential } from './connection';

vi.mock('@/lib/integrations/management', () => ({ loadConnection: vi.fn(), readConnectionCredential: vi.fn() }));
vi.mock('@/lib/integrations/provider-http', () => ({ providerHttp: vi.fn() }));
const org = '11111111-1111-4111-8111-111111111111';
const id = '22222222-2222-4222-8222-222222222222';
const secret = { page_id: '1234', token: 'synthetic-token', app_secret: 'a'.repeat(32), verify_token: 'synthetic_verify_token', graph_version: 'v26.0' };
const connection = { id, provider: 'messenger', label: 'Synthetic Page', revision: 1, active: true, auth_kind: 'api_key', validated_at: null, failure_code: null };
const db = {} as Parameters<typeof resolveMessengerConnection>[0];
const scope = { organizationId: org, connectionId: id, pageId: '1234' };
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(loadConnection).mockResolvedValue(connection);
  vi.mocked(readConnectionCredential).mockResolvedValue(JSON.stringify(secret));
  vi.mocked(providerHttp).mockResolvedValue({ status: 200, data: { id: '1234' } });
});
describe('Messenger connection credentials', () => {
  it('validates the required secret and Page configuration without accepting extra fields', () => {
    expect(messengerCredentialSchema.safeParse(secret).success).toBe(true);
    expect(messengerCredentialSchema.safeParse({ ...secret, organization_id: org }).success).toBe(false);
    expect(messengerCredentialSchema.safeParse({ ...secret, app_secret: '' }).success).toBe(false);
    expect(messengerCredentialSchema.safeParse({ ...secret, token: 'token\nextra' }).success).toBe(false);
  });
  it('checks the token identity, not merely access to an arbitrary Page', async () => {
    expect(await testMessengerCredential(JSON.stringify(secret))).toBe(true);
    expect(providerHttp).toHaveBeenCalledWith('https://graph.facebook.com/v26.0/me?fields=id', 'GET', { Authorization: 'Bearer synthetic-token' });
    vi.mocked(providerHttp).mockResolvedValue({ status: 200, data: { id: '9999' } });
    expect(await testMessengerCredential(JSON.stringify(secret))).toBe(false);
  });
  it('does not surface a provider error or accept an unsuccessful HTTP result', async () => {
    vi.mocked(providerHttp).mockResolvedValue({ status: 403, data: { id: '1234', error: 'sensitive' } });
    expect(await testMessengerCredential(JSON.stringify(secret))).toBe(false);
    vi.mocked(providerHttp).mockRejectedValue(new Error('sensitive'));
    expect(await testMessengerCredential(JSON.stringify(secret))).toBe(false);
  });
  it('uses the existing scoped vault and revalidates connection revision', async () => {
    expect(await resolveMessengerConnection(db, scope)).toEqual({ organizationId: org, pageId: '1234', token: 'synthetic-token', graphVersion: 'v26.0', active: true });
    expect(loadConnection).toHaveBeenNthCalledWith(1, db, org, id);
    expect(loadConnection).toHaveBeenNthCalledWith(2, db, org, id);
    expect(readConnectionCredential).toHaveBeenCalledWith(db, org, connection);
  });
  it.each([null, { ...connection, active: false }, { ...connection, provider: 'stripe' }])('does not open unavailable or wrong-provider credentials', async value => {
    vi.mocked(loadConnection).mockResolvedValue(value);
    expect(await resolveMessengerConnection(db, scope)).toBeNull();
    expect(readConnectionCredential).not.toHaveBeenCalled();
  });
  it('rejects a saved credential for another Page', async () => {
    expect(await resolveMessengerConnection(db, { ...scope, pageId: '9999' })).toBeNull();
  });
  it.each([{ ...connection, active: false }, { ...connection, revision: 2 }, null])('rejects rotation/disconnection during resolution', async current => {
    vi.mocked(loadConnection).mockResolvedValueOnce(connection).mockResolvedValueOnce(current);
    expect(await resolveMessengerConnection(db, scope)).toBeNull();
  });
});
