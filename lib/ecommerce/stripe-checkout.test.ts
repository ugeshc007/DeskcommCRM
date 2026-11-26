// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { createStripeCheckout } from './stripe-checkout';
import { providerHttp } from '@/lib/integrations/provider-http';
vi.mock('@/lib/integrations/provider-http', () => ({ providerHttp: vi.fn() }));
const input = { order_id: '11111111-1111-4111-8111-111111111111', organization_id: '22222222-2222-4222-8222-222222222222', token: 'synthetic', expires_at: 1800000000, return_url: 'https://crm.example/checkout/return',
  quote: { status: 'quoted' as const, currency: 'AED', country_code: 'AE', items: [{ sku: 'S', name: 'Synthetic', quantity: 1, unit_price_cents: 1000, total_cents: 1000 }], subtotal_cents: 1000, delivery_cents: 100, total_cents: 1100, delivery_rule_id: 'domestic', delivery_information: '', fingerprint: 'a'.repeat(64) } };
beforeEach(() => { vi.clearAllMocks(); vi.mocked(providerHttp).mockResolvedValue({ status: 200, data: { id: 'cs_test_synthetic', url: 'https://checkout.stripe.com/c/pay/synthetic', amount_total: 1100, currency: 'aed', client_reference_id: input.order_id } }); });
it('uses a stable idempotency key, exact prices and bearer headers', async () => {
  expect(await createStripeCheckout(input)).toMatchObject({ session_id: 'cs_test_synthetic' });
  const call = vi.mocked(providerHttp).mock.calls[0]!;
  expect(call[0]).toBe('https://api.stripe.com/v1/checkout/sessions');
  expect(call[2]).toMatchObject({ Authorization: 'Bearer synthetic', 'Idempotency-Key': 'store-checkout-' + input.order_id });
  const params = new URLSearchParams(call[3]);
  expect(params.get('line_items[0][price_data][unit_amount]')).toBe('1000');
  expect(params.get('shipping_options[0][shipping_rate_data][fixed_amount][amount]')).toBe('100');
  expect(params.get('shipping_address_collection[allowed_countries][0]')).toBe('AE');
});
it('does not retry network uncertainty or expose a remote secret', async () => {
  vi.mocked(providerHttp).mockRejectedValue(new Error('sensitive provider data'));
  await expect(createStripeCheckout(input)).rejects.toMatchObject({ outcome: 'uncertain', message: 'store_payment_uncertain' });
  expect(providerHttp).toHaveBeenCalledTimes(1);
});
it('rejects mismatched provider totals without claiming a payable session', async () => {
  vi.mocked(providerHttp).mockResolvedValue({ status: 200, data: { id: 'cs_test_wrong', url: 'https://checkout.stripe.com/c/pay/synthetic', amount_total: 999, currency: 'aed', client_reference_id: input.order_id } });
  await expect(createStripeCheckout(input)).rejects.toMatchObject({ outcome: 'uncertain' });
});
