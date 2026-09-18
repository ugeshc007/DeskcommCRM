import { describe, expect, it } from 'vitest';
import { emptyStoreConfig } from './config';
import { quoteCheckout, paymentMatchesOrder } from './checkout';

const product = { sku: 'CHAIR', name: 'Chair', category: 'Furniture', description: '', price_cents: 12500, currency: 'AED', stock: 5, variants: [], media: [], product_link: null };
const input = {
  products: [product], locale: { country_code: 'AE', currency: 'AED', timezone: 'Asia/Dubai' },
  request: { country_code: 'AE', currency: 'AED', items: [{ sku: 'CHAIR', quantity: 2 }] },
  config: { ...emptyStoreConfig(), courier_rules: [{ id: 'local', label: 'Local', scope: 'domestic', countries: [], currency: 'AED', mode: 'flat', charge_cents: 1000, free_above_cents: null, delivery_information: 'Confirm dispatch date with staff.' }] },
};
describe('authoritative checkout quotes', () => {
  it('uses catalogue prices and configured domestic delivery', () => {
    expect(quoteCheckout(input)).toMatchObject({ status: 'quoted', subtotal_cents: 25000, delivery_cents: 1000, total_cents: 26000, currency: 'AED' });
  });
  it('refuses customer-supplied price fields', () => {
    expect(quoteCheckout({ ...input, request: { ...input.request, total_cents: 1 } }).status).toBe('needs_review');
  });
  it('combines duplicate lines before checking available stock', () => {
    expect(quoteCheckout({ ...input, request: { ...input.request, items: [{ sku: 'CHAIR', quantity: 3 }, { sku: 'CHAIR', quantity: 3 }] } })).toEqual({ status: 'needs_review', reason: 'insufficient_stock' });
  });
  it('does not assume unknown stock is available', () => {
    expect(quoteCheckout({ ...input, products: [{ ...product, stock: null }] })).toEqual({ status: 'needs_review', reason: 'stock_unknown' });
  });
  it('does not silently convert currency or invent international delivery', () => {
    expect(quoteCheckout({ ...input, request: { ...input.request, currency: 'USD' } })).toEqual({ status: 'needs_review', reason: 'unsupported_currency' });
    expect(quoteCheckout({ ...input, request: { ...input.request, country_code: 'GB' } })).toEqual({ status: 'needs_review', reason: 'delivery_not_available' });
  });
  it('requires a real unambiguous courier rate', () => {
    expect(quoteCheckout({ ...input, config: emptyStoreConfig() })).toEqual({ status: 'needs_review', reason: 'missing_rate' });
  });
  it('changes the confirmation fingerprint when prices change', () => {
    const a = quoteCheckout(input), b = quoteCheckout({ ...input, products: [{ ...product, price_cents: 13000 }] });
    expect(a.status).toBe('quoted'); expect(b.status).toBe('quoted');
    if (a.status === 'quoted' && b.status === 'quoted') expect(a.fingerprint).not.toBe(b.fingerprint);
  });
  it('prevents overflow instead of charging a rounded total', () => {
    expect(quoteCheckout({ ...input, products: [{ ...product, price_cents: Number.MAX_SAFE_INTEGER }] })).toEqual({ status: 'needs_review', reason: 'amount_overflow' });
  });
});
describe('payment identity and amount', () => {
  const order = { id: 'order-a', organization_id: 'org-a', session_id: 'session-a', total_cents: 26000, currency: 'AED' };
  const event = { order_id: order.id, organization_id: order.organization_id, session_id: order.session_id, amount_total: order.total_cents, currency: 'aed', payment_status: 'paid' };
  it('matches only the exact order/session/tenant/amount/currency', () => {
    expect(paymentMatchesOrder(order, event)).toBe(true);
    for (const changed of [{ order_id: 'other' }, { organization_id: 'other' }, { session_id: 'other' }, { amount_total: 1 }, { currency: 'usd' }, { payment_status: 'unpaid' }])
      expect(paymentMatchesOrder(order, { ...event, ...changed })).toBe(false);
  });
});
