import { z } from 'zod';
import { providerHttp } from '@/lib/integrations/provider-http';
import type { CheckoutQuote } from './checkout';

type ReadyQuote = Extract<CheckoutQuote, { status: 'quoted' }>;
export class CheckoutProviderError extends Error {
  constructor(readonly outcome: 'rejected' | 'uncertain') { super('store_payment_' + outcome); }
}

/** Un seul ordre = une clé d'idempotence stable. Aucun montant du client. */
export async function createStripeCheckout(input: {
  order_id: string; organization_id: string; token: string; quote: ReadyQuote;
  expires_at: number; return_url: string;
}) {
  z.uuid().parse(input.order_id); z.uuid().parse(input.organization_id);
  if (!input.token || /[\r\n]/.test(input.token)) throw new CheckoutProviderError('rejected');
  const returnUrl = new URL(input.return_url);
  if (returnUrl.protocol !== 'https:' || returnUrl.username || returnUrl.password) throw new CheckoutProviderError('rejected');
  const q = input.quote;
  const body = new URLSearchParams({ mode: 'payment', locale: 'en', success_url: returnUrl.toString(), cancel_url: returnUrl.toString(),
    client_reference_id: input.order_id, 'metadata[order_id]': input.order_id, 'metadata[organization_id]': input.organization_id,
    expires_at: String(input.expires_at), 'payment_method_types[0]': 'card',
    'shipping_address_collection[allowed_countries][0]': q.country_code,
    'shipping_options[0][shipping_rate_data][type]': 'fixed_amount',
    'shipping_options[0][shipping_rate_data][display_name]': 'Configured delivery',
    'shipping_options[0][shipping_rate_data][fixed_amount][amount]': String(q.delivery_cents),
    'shipping_options[0][shipping_rate_data][fixed_amount][currency]': q.currency.toLowerCase(),
  });
  for (const [index, item] of q.items.entries()) {
    body.set(`line_items[${index}][price_data][currency]`, q.currency.toLowerCase());
    body.set(`line_items[${index}][price_data][unit_amount]`, String(item.unit_price_cents));
    body.set(`line_items[${index}][price_data][product_data][name]`, item.name);
    body.set(`line_items[${index}][quantity]`, String(item.quantity));
  }
  let response: Awaited<ReturnType<typeof providerHttp>>;
  try {
    response = await providerHttp('https://api.stripe.com/v1/checkout/sessions', 'POST', {
      Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': 'store-checkout-' + input.order_id,
    }, body.toString());
  } catch { throw new CheckoutProviderError('uncertain'); }
  if (response.status >= 400 && response.status < 500) throw new CheckoutProviderError('rejected');
  if (response.status !== 200) throw new CheckoutProviderError('uncertain');
  const parsed = z.object({ id: z.string().regex(/^cs_[A-Za-z0-9_]+$/), url: z.url(),
    amount_total: z.number().int().nonnegative(), currency: z.string(), client_reference_id: z.string() }).safeParse(response.data);
  if (!parsed.success || parsed.data.amount_total !== q.total_cents || parsed.data.currency.toUpperCase() !== q.currency || parsed.data.client_reference_id !== input.order_id)
    throw new CheckoutProviderError('uncertain');
  const paymentUrl = new URL(parsed.data.url);
  if (paymentUrl.protocol !== 'https:' || paymentUrl.hostname !== 'checkout.stripe.com' || paymentUrl.username || paymentUrl.password)
    throw new CheckoutProviderError('uncertain');
  return { session_id: parsed.data.id, payment_url: paymentUrl.toString() };
}
