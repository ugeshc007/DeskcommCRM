import { describe, expect, it } from 'vitest';
import { emptyStoreConfig, productTemplateSchema, storeConfigSchema, type StoreConfig } from './config';
import { quoteDelivery } from './delivery';

const locale = { country_code: 'AE', currency: 'AED', timezone: 'Asia/Dubai' };
function configured(): StoreConfig {
  return { ...emptyStoreConfig(), courier_rules: [{ id: 'standard', label: 'Standard', scope: 'domestic', countries: ['AE'],
    currency: 'AED', mode: 'flat', charge_cents: 2000, free_above_cents: 10000, delivery_information: 'Delivery estimate must be confirmed.' }] };
}
describe('organization store delivery', () => {
  it('does not invent a rate before configuration', () => {
    expect(quoteDelivery(emptyStoreConfig(), locale, { country_code: 'AE', currency: 'AED', subtotal_cents: 1000 }))
      .toEqual({ status: 'needs_review', reason: 'missing_rate' });
  });
  it('quotes only the configured currency and applies the inclusive free threshold', () => {
    expect(quoteDelivery(configured(), locale, { country_code: 'AE', currency: 'AED', subtotal_cents: 9999 }))
      .toMatchObject({ status: 'quoted', charge_cents: 2000, currency: 'AED' });
    expect(quoteDelivery(configured(), locale, { country_code: 'AE', currency: 'AED', subtotal_cents: 10000 }))
      .toMatchObject({ status: 'quoted', charge_cents: 0 });
    expect(quoteDelivery(configured(), locale, { country_code: 'AE', currency: 'USD', subtotal_cents: 10000 }))
      .toEqual({ status: 'needs_review', reason: 'invalid_request' });
  });
  it('uses the organization country, not a fixed country or customer phone prefix', () => {
    expect(quoteDelivery(configured(), { country_code: 'IN', currency: 'INR', timezone: 'Asia/Kolkata' },
      { country_code: 'AE', currency: 'INR', subtotal_cents: 1000 })).toEqual({ status: 'not_available' });
  });
  it('blocks international destinations when domestic-only is selected', () => {
    expect(quoteDelivery(configured(), locale, { country_code: 'IN', currency: 'AED', subtotal_cents: 1000 }))
      .toEqual({ status: 'not_available' });
  });
  it('requires a matching international rate rather than reusing a domestic charge', () => {
    const config = { ...configured(), delivery_scope: 'domestic_and_international' as const };
    expect(quoteDelivery(config, locale, { country_code: 'IN', currency: 'AED', subtotal_cents: 1000 }))
      .toEqual({ status: 'needs_review', reason: 'missing_rate' });
    config.courier_rules.push({ ...config.courier_rules[0]!, id: 'international', scope: 'international', countries: ['IN'], charge_cents: 9000 });
    expect(quoteDelivery(config, locale, { country_code: 'IN', currency: 'AED', subtotal_cents: 1000 }))
      .toMatchObject({ status: 'quoted', charge_cents: 9000 });
  });
  it('does not select an arbitrary overlapping rate', () => {
    const config = configured();
    config.courier_rules.push({ ...config.courier_rules[0]!, id: 'overlap', countries: [] });
    expect(quoteDelivery(config, locale, { country_code: 'AE', currency: 'AED', subtotal_cents: 1000 }))
      .toEqual({ status: 'needs_review', reason: 'ambiguous_rate' });
  });
  it('requires human review for carrier quotations that are not implemented', () => {
    const config = configured();
    config.courier_rules[0] = { ...config.courier_rules[0]!, mode: 'manual_quote', charge_cents: null, free_above_cents: null };
    expect(quoteDelivery(config, locale, { country_code: 'AE', currency: 'AED', subtotal_cents: 1000 }))
      .toEqual({ status: 'needs_review', reason: 'manual_quote' });
  });
  it.each([-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid money %s', subtotal_cents => {
    expect(quoteDelivery(configured(), locale, { country_code: 'AE', currency: 'AED', subtotal_cents }))
      .toEqual({ status: 'needs_review', reason: 'invalid_request' });
  });
  it('returns independent configurations, not shared mutable organization state', () => {
    const a = emptyStoreConfig(); a.categories.push('Electronics');
    expect(emptyStoreConfig().categories).toEqual([]);
  });
  it('rejects unconfigured rates, duplicate rule IDs and disabled international settings', () => {
    const config = configured(); config.courier_rules[0]!.charge_cents = null;
    expect(storeConfigSchema.safeParse(config).success).toBe(false);
    const duplicate = configured(); duplicate.courier_rules.push({ ...duplicate.courier_rules[0]! });
    expect(storeConfigSchema.safeParse(duplicate).success).toBe(false);
    const international = configured(); international.courier_rules[0]!.scope = 'international';
    expect(storeConfigSchema.safeParse(international).success).toBe(false);
  });
  it('does not accept credentials or another organization through configuration', () => {
    expect(storeConfigSchema.safeParse({ ...emptyStoreConfig(), organization_id: 'foreign' }).success).toBe(false);
    expect(storeConfigSchema.safeParse({ ...emptyStoreConfig(), api_key: 'secret' }).success).toBe(false);
  });
  it('validates variant SKUs, money, stock and safe product links', () => {
    const product = { sku: 'SKU-1', name: 'Example', category: 'Home', description: '', price_cents: 1000, currency: 'AED',
      stock: null, variants: [], media: [], product_link: 'https://example.test/product' };
    expect(productTemplateSchema.safeParse(product).success).toBe(true);
    expect(productTemplateSchema.safeParse({ ...product, price_cents: -1 }).success).toBe(false);
    expect(productTemplateSchema.safeParse({ ...product, product_link: 'https://user:secret@example.test/' }).success).toBe(false);
    expect(productTemplateSchema.safeParse({ ...product, variants: [{ sku: 'SKU-1', name: 'Red', price_cents: 1000, stock: 1 }] }).success).toBe(false);
  });
});
