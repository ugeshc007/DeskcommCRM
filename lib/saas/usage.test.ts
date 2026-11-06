import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { countBillingChannels } from './usage';

function database(result: { count: number | null; error: unknown }) {
  const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn().mockResolvedValue(result) };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  const from = vi.fn().mockReturnValue(query);
  return { client: { from } as unknown as SupabaseClient, from, query };
}
describe('billing channel usage', () => {
  it('counts only the trusted organization and excludes archived channels', async () => {
    const db = database({ count: 3, error: null });
    expect(await countBillingChannels(db.client, 'organization-a')).toBe(3);
    expect(db.from).toHaveBeenCalledWith('channel_sessions');
    expect(db.query.select).toHaveBeenCalledWith('*', { count: 'exact', head: true });
    expect(db.query.eq).toHaveBeenCalledWith('organization_id', 'organization-a');
    expect(db.query.is).toHaveBeenCalledWith('archived_at', null);
  });
  it.each([{ count: null, error: null }, { count: 0, error: { message: 'denied' } }])('does not display a failed query as zero usage', async result => {
    await expect(countBillingChannels(database(result).client, 'organization-a')).rejects.toThrow('billing_channel_usage_unavailable');
  });
  it('accepts a measured zero', async () => {
    expect(await countBillingChannels(database({ count: 0, error: null }).client, 'organization-a')).toBe(0);
  });
});
