import { z } from 'zod';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { ok, fail } from '@/lib/api/wrappers';
import { readIntegrationJson } from '../integration-connections/_shared';
import { manageStore } from '@/lib/ecommerce/management';

export async function GET() {
  const auth = await requireRole('admin'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Use an organization administrator account for store setup.', 403);
  try {
    const db = getRequestPool(), org = auth.org.orgId;
    const installed = await db.query("select to_regclass('public.store_settings') is not null installed");
    if (!installed.rows[0].installed) return ok({ installed: false }, { headers: { 'Cache-Control': 'no-store' } });
    const [settings, products, orders, payments, contacts, locale] = await Promise.all([
      db.query('select revision,active,automated_checkout,config,prices_include_all_taxes,payment_connection_id,reservation_minutes from public.store_settings where organization_id=$1', [org]),
      db.query('select sku,revision,active,product,stock_on_hand,stock_reserved from public.store_products where organization_id=$1 order by sku limit 500', [org]),
      // Lien payable uniquement via l'action qui revalide la connexion courante.
      db.query('select id,status,stock_state,quote,total_cents,currency,created_at from public.store_orders where organization_id=$1 order by created_at desc limit 100', [org]),
      db.query("select id,label,active from public.integration_connections where organization_id=$1 and provider='stripe' order by label", [org]),
      db.query('select id,display_name from public.contacts where organization_id=$1 and not is_anonymized and not is_blocked and is_merged_into is null order by created_at desc limit 100', [org]),
      db.query('select onboarding_state,currency,timezone from public.organizations where id=$1', [org]),
    ]);
    const regional = locale.rows[0];
    return ok({ installed: true, settings: settings.rows[0] ?? null, products: products.rows, orders: orders.rows,
      payment_connections: payments.rows, contacts: contacts.rows,
      locale: { country_code: regional?.onboarding_state?.welcome?.country_code ?? null, currency: regional?.currency, timezone: regional?.timezone } },
    { headers: { 'Cache-Control': 'no-store' } });
  } catch { return fail('service_unavailable', 'Store data is unavailable. Please retry.', 503); }
}

export async function POST(req: Request) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const auth = await requireRole('admin'); if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Use an organization administrator account for store setup.', 403);
  try {
    return ok(await manageStore(getRequestPool(), auth.org.orgId, auth.user.id, await readIntegrationJson(req)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return fail('validation_failed', 'Review the required store fields and currency amounts.', 422);
    const code = error instanceof Error ? error.message : '';
    if (code === 'invalid_request') return fail('validation_failed', 'The store request is missing or too large.', 422);
    if (code === 'store_forbidden') return fail('forbidden', 'Current administrator access is required.', 403);
    const corrections: Record<string, string> = {
      store_revision_conflict: 'This record changed. Refresh before saving again.',
      store_inventory_reserved: 'Stock is reserved by pending orders. Do not remove it until payments are reconciled.',
      store_variant_separate_sku: 'Save each purchasable variant as its own SKU and stock record.',
      store_payment_connection_unavailable: 'Choose a payment connection owned by this organization.',
      store_checkout_not_configured: 'Choose a payment connection and confirm tax-inclusive pricing before enabling checkout.',
    };
    if (corrections[code]) return fail('state_conflict', corrections[code], 409);
    return fail('service_unavailable', 'Store changes could not be confirmed. Refresh before retrying.', 503);
  }
}
