import { createHash } from 'node:crypto';
import { z } from 'zod';
import { productTemplateSchema, storeConfigSchema, storeLocaleSchema } from './config';
import { quoteDelivery } from './delivery';

export const cartRequestSchema = z.strictObject({
  currency: z.string().regex(/^[A-Z]{3}$/),
  country_code: z.string().regex(/^[A-Z]{2}$/),
  items: z.array(z.strictObject({ sku: z.string().trim().min(1).max(100), quantity: z.number().int().min(1).max(10000) })).min(1).max(100),
});
export type CartRequest = z.infer<typeof cartRequestSchema>;
export type QuotedItem = { sku: string; name: string; quantity: number; unit_price_cents: number; total_cents: number };
export type CheckoutQuote = {
  status: 'quoted'; currency: string; country_code: string; items: QuotedItem[];
  subtotal_cents: number; delivery_cents: number; total_cents: number;
  delivery_rule_id: string; delivery_information: string; fingerprint: string;
} | { status: 'needs_review'; reason: string };

/** Dados do catálogo, políticas e região devem vir do banco da organização.
 * Não aceita preços, estoque ou taxas do browser/LLM. Reserva é outra transação.
 */
export function quoteCheckout(input: {
  request: unknown; products: unknown; config: unknown; locale: unknown;
}): CheckoutQuote {
  const request = cartRequestSchema.safeParse(input.request);
  const products = z.array(productTemplateSchema).max(10000).safeParse(input.products);
  const config = storeConfigSchema.safeParse(input.config);
  const locale = storeLocaleSchema.safeParse(input.locale);
  if (!request.success || !products.success || !config.success || !locale.success)
    return { status: 'needs_review', reason: 'invalid_configuration_or_cart' };
  if (![locale.data.currency, ...config.data.additional_currencies].includes(request.data.currency))
    return { status: 'needs_review', reason: 'unsupported_currency' };
  const catalogue = new Map<string, { name: string; currency: string; price: number; stock: number | null }>();
  for (const product of products.data) {
    for (const item of [{ ...product }, ...product.variants.map(v => ({ ...v, currency: product.currency, name: `${product.name} — ${v.name}` }))]) {
      if (catalogue.has(item.sku)) return { status: 'needs_review', reason: 'ambiguous_sku' };
      catalogue.set(item.sku, { name: item.name, currency: item.currency, price: item.price_cents, stock: item.stock });
    }
  }
  const quantities = new Map<string, number>();
  for (const item of request.data.items) quantities.set(item.sku, (quantities.get(item.sku) ?? 0) + item.quantity);
  const items: QuotedItem[] = [];
  let subtotal = 0;
  for (const [sku, quantity] of [...quantities.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const item = catalogue.get(sku);
    if (!item) return { status: 'needs_review', reason: 'product_not_found' };
    if (item.currency !== request.data.currency) return { status: 'needs_review', reason: 'product_currency_mismatch' };
    if (item.stock === null) return { status: 'needs_review', reason: 'stock_unknown' };
    if (quantity > item.stock) return { status: 'needs_review', reason: 'insufficient_stock' };
    const line = item.price * quantity;
    subtotal += line;
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(subtotal)) return { status: 'needs_review', reason: 'amount_overflow' };
    items.push({ sku, name: item.name, quantity, unit_price_cents: item.price, total_cents: line });
  }
  const delivery = quoteDelivery(config.data, locale.data, { country_code: request.data.country_code, currency: request.data.currency, subtotal_cents: subtotal });
  if (delivery.status !== 'quoted') return { status: 'needs_review', reason: delivery.status === 'not_available' ? 'delivery_not_available' : delivery.reason };
  const total = subtotal + delivery.charge_cents;
  if (!Number.isSafeInteger(total)) return { status: 'needs_review', reason: 'amount_overflow' };
  const quote = { currency: request.data.currency, country_code: request.data.country_code, items,
    subtotal_cents: subtotal, delivery_cents: delivery.charge_cents, total_cents: total,
    delivery_rule_id: delivery.rule_id, delivery_information: delivery.information };
  return { status: 'quoted', ...quote, fingerprint: createHash('sha256').update(JSON.stringify(quote)).digest('hex') };
}

/** Prova de pagamento exige evento verificado, vínculo e valores exatos.
 * Esta função não verifica HMAC: só pode receber eventos do verificador servidor.
 */
export function paymentMatchesOrder(order: { id: string; organization_id: string; session_id: string; total_cents: number; currency: string }, event: {
  order_id: string; organization_id: string; session_id: string; amount_total: number;
  currency: string; payment_status: string;
}): boolean {
  return event.payment_status === 'paid' && event.order_id === order.id && event.organization_id === order.organization_id &&
    event.session_id === order.session_id && Number.isSafeInteger(event.amount_total) && event.amount_total === order.total_cents &&
    event.currency.toUpperCase() === order.currency;
}
