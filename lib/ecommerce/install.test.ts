import { expect, it, vi } from 'vitest';
import { installStoreDraft, storeInstallSchema } from './install';
import { emptyStoreConfig } from './config';

const id = '11111111-1111-4111-8111-111111111111';
const input = { channel_session_id: id, provider: 'openai', model: 'synthetic-model', credential_id: null, config: emptyStoreConfig() };
it('rejects authority, publication flags and extra settings before opening a database connection', async () => {
  const pool = { connect: vi.fn() };
  for (const extra of [{ organization_id: id }, { actor_id: id }, { publish: true }, { is_active: true }])
    await expect(installStoreDraft(pool, id, id, { ...input, ...extra })).rejects.toThrow();
  expect(pool.connect).not.toHaveBeenCalled();
});
it('accepts an explicit draft configuration without requiring or embedding API keys', () => {
  expect(storeInstallSchema.parse(input)).toEqual(input);
  expect(storeInstallSchema.safeParse({ ...input, api_key: 'synthetic-secret' }).success).toBe(false);
});
