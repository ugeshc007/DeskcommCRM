import { storeConfigSchema, storeLocaleSchema, type StoreConfig, type StoreLocale } from './config';

export type DeliveryQuote =
  | { status: 'quoted'; charge_cents: number; currency: string; rule_id: string; information: string }
  | { status: 'not_available' }
  | { status: 'needs_review'; reason: 'missing_rate' | 'ambiguous_rate' | 'manual_quote' | 'invalid_configuration' | 'invalid_request' };

/** Pure quote, never currency conversion, carrier booking, or an order total. */
export function quoteDelivery(config: StoreConfig, locale: StoreLocale, request: {
  country_code: string; currency: string; subtotal_cents: number;
}): DeliveryQuote {
  if (!storeConfigSchema.safeParse(config).success || !storeLocaleSchema.safeParse(locale).success)
    return { status: 'needs_review', reason: 'invalid_configuration' };
  if (!/^[A-Z]{2}$/.test(request.country_code) || !Number.isSafeInteger(request.subtotal_cents) || request.subtotal_cents < 0 ||
      ![locale.currency, ...config.additional_currencies].includes(request.currency))
    return { status: 'needs_review', reason: 'invalid_request' };
  const scope = request.country_code === locale.country_code ? 'domestic' : 'international';
  if (scope === 'international' && config.delivery_scope === 'domestic_only') return { status: 'not_available' };
  const rules = config.courier_rules.filter(rule => rule.scope === scope && rule.currency === request.currency &&
    (rule.countries.length === 0 || rule.countries.includes(request.country_code)));
  if (rules.length === 0) return { status: 'needs_review', reason: 'missing_rate' };
  if (rules.length !== 1) return { status: 'needs_review', reason: 'ambiguous_rate' };
  const rule = rules[0]!;
  if (rule.mode !== 'flat' || rule.charge_cents === null) return { status: 'needs_review', reason: 'manual_quote' };
  return { status: 'quoted', rule_id: rule.id, currency: rule.currency, information: rule.delivery_information,
    charge_cents: rule.free_above_cents !== null && request.subtotal_cents >= rule.free_above_cents ? 0 : rule.charge_cents };
}
