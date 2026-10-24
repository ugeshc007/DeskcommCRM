import { z } from 'zod';
import type { EventHandler } from '@/lib/event-log/dispatcher';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { createAdminClient } from '@/lib/supabase/admin';
import { reconcileStoreOrder } from '@/lib/ecommerce/reconcile';

export const storePaymentHandler: EventHandler = {
  key: 'store_payment.v1', events: ['store.payment_reconcile'],
  async handle(row) {
    const key = 'store_payment.v1', id = z.uuid().safeParse(row.entity_id);
    if (!id.success) return { consumer_key: key, status: 'error', detail: 'invalid_order_identity' };
    try {
      const state = await reconcileStoreOrder(getRequestPool(), createAdminClient(), row.organization_id, id.data);
      return state === 'done' ? { consumer_key: key, status: 'ok' }
        : { consumer_key: key, status: 'retry', retry_at: new Date(Date.now() + 60000).toISOString(), detail: 'awaiting_payment_update' };
    } catch {
      // Backoff e dead-letter canônicos; nenhum segredo ou payload do provedor.
      return { consumer_key: key, status: 'error', detail: 'store_payment_reconciliation_required' };
    }
  },
};
