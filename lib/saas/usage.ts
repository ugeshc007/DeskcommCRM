import type { SupabaseClient } from '@supabase/supabase-js';

/** Billing counts all non-archived channel types, not only messaging destinations. */
export async function countBillingChannels(db: SupabaseClient, organizationId: string): Promise<number> {
  const { count, error } = await db.from('channel_sessions')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', organizationId).is('archived_at', null);
  if (error || count === null) throw new Error('billing_channel_usage_unavailable');
  return count;
}
