import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ConnectorRejected, executeIntegration, type ConnectorAction, type IntegrationExecutionStore } from './execution';

const org = '11111111-1111-4111-8111-111111111111';
const foreign = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const scope = { organizationId: org, executionKey: 'enrollment:node:visit' };
const request = { connectionId: id, revision: 1, action: 'save_lead', input: { name: 'Synthetic' } };
const connection = { id, organizationId: org, provider: 'test', revision: 1, active: true };
const execute = vi.fn<ConnectorAction['execute']>();
const action: ConnectorAction = { provider: 'test', action: 'save_lead', retry: 'provider_idempotent', input: z.strictObject({ name: z.string().min(1) }), output: z.strictObject({ external_id: z.string() }), execute };
const store = { connection: vi.fn(), claim: vi.fn(), withCredential: vi.fn(), finish: vi.fn() } satisfies IntegrationExecutionStore;
beforeEach(() => {
  vi.resetAllMocks();
  store.connection.mockResolvedValue(connection); store.claim.mockResolvedValue({ kind: 'acquired', lease: 'lease' });
  store.withCredential.mockImplementation(async (_org, _id, _rev, consume) => consume('synthetic-secret'));
  store.finish.mockResolvedValue(undefined); execute.mockResolvedValue({ external_id: 'synthetic-1' });
});
describe('organization-bound integration execution framework', () => {
  it('replays a terminal failure without executing again', async () => {
    store.claim.mockResolvedValue({ kind: 'failed', code: 'provider_rejected' });
    expect(await executeIntegration(scope, request, [action], store)).toEqual({ status: 'failed', code: 'provider_rejected' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('validates, claims, checks current ownership and records only projected output', async () => {
    expect(await executeIntegration(scope, request, [action], store)).toEqual({ status: 'succeeded', output: { external_id: 'synthetic-1' }, replayed: false });
    expect(store.connection).toHaveBeenCalledTimes(2);
    expect(store.withCredential).toHaveBeenCalledWith(org, id, 1, expect.any(Function));
    expect(store.finish).toHaveBeenCalledWith(scope, 'lease', { status: 'succeeded', output: { external_id: 'synthetic-1' } });
    expect(JSON.stringify(store.finish.mock.calls)).not.toContain('synthetic-secret');
  });
  it.each([{ organizationId: foreign }, { id: foreign }, { active: false }, { revision: 2 }])('rejects wrong or revoked identity %j before claim', async overrides => {
    store.connection.mockResolvedValue({ ...connection, ...overrides });
    expect(await executeIntegration(scope, request, [action], store)).toMatchObject({ status: 'failed', code: 'connection_unavailable' });
    expect(store.claim).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it('rejects rotation between initial lookup and execution', async () => {
    store.connection.mockResolvedValueOnce(connection).mockResolvedValueOnce({ ...connection, revision: 2 });
    expect(await executeIntegration(scope, request, [action], store)).toMatchObject({ code: 'connection_unavailable' });
    expect(store.withCredential).not.toHaveBeenCalled();
  });
  it.each(['busy', 'indeterminate', 'conflict'])('does not execute a %s claim', async kind => {
    store.claim.mockResolvedValue({ kind });
    await executeIntegration(scope, request, [action], store);
    expect(execute).not.toHaveBeenCalled(); expect(store.withCredential).not.toHaveBeenCalled();
  });
  it('replays a completed result without reading credentials or making a request', async () => {
    store.claim.mockResolvedValue({ kind: 'completed', output: { external_id: 'saved' } });
    expect(await executeIntegration(scope, request, [action], store)).toMatchObject({ status: 'succeeded', replayed: true, output: { external_id: 'saved' } });
    expect(store.withCredential).not.toHaveBeenCalled();
  });
  it('does not retry ambiguous effects or persist provider diagnostics', async () => {
    execute.mockRejectedValue(new Error('Authorization: synthetic-secret provider response body'));
    expect(await executeIntegration(scope, request, [action], store)).toMatchObject({ status: 'pending', code: 'reconciliation_required' });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(store.finish.mock.calls)).not.toContain('synthetic-secret');
  });
  it('distinguishes a proved no-effect rejection', async () => {
    execute.mockRejectedValue(new ConnectorRejected());
    expect(await executeIntegration(scope, request, [action], store)).toMatchObject({ status: 'failed', code: 'provider_rejected' });
  });
  it('does not expose extra secret fields in a provider response', async () => {
    execute.mockResolvedValue({ external_id: 'saved', token: 'synthetic-secret' } as never);
    expect(await executeIntegration(scope, request, [action], store)).toMatchObject({ status: 'pending', code: 'invalid_output' });
    expect(JSON.stringify(store.finish.mock.calls)).not.toContain('synthetic-secret');
  });
  it('does not accept organization or credential fields in the action request', async () => {
    expect(await executeIntegration(scope, { ...request, organization_id: foreign }, [action], store)).toMatchObject({ code: 'invalid_input' });
    expect(await executeIntegration(scope, { ...request, input: { ...request.input, api_key: 'synthetic-secret' } }, [action], store)).toMatchObject({ code: 'invalid_input' });
    expect(execute).not.toHaveBeenCalled();
  });
  it('keeps provider idempotency identity stable for the same execution', async () => {
    await executeIntegration(scope, request, [action], store);
    await executeIntegration(scope, request, [action], store);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[1].idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(execute.mock.calls[0]?.[1]).toEqual(execute.mock.calls[1]?.[1]);
  });
});
