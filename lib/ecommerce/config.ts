import { z } from 'zod';

const currency = z.string().regex(/^[A-Z]{3}$/);
const country = z.string().regex(/^[A-Z]{2}$/);
const cents = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const httpsUrl = z.url().refine(value => {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password;
}, 'Use an HTTPS URL without embedded credentials.');

export const courierRuleSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/),
  label: z.string().trim().min(1).max(100),
  scope: z.enum(['domestic', 'international']),
  countries: z.array(country).max(250),
  currency,
  mode: z.enum(['flat', 'manual_quote']),
  charge_cents: cents.nullable(),
  free_above_cents: cents.nullable(),
  delivery_information: z.string().trim().max(1000),
}).superRefine((rule, ctx) => {
  if (rule.mode === 'flat' && rule.charge_cents === null)
    ctx.addIssue({ code: 'custom', path: ['charge_cents'], message: 'A flat rate needs an explicit charge, including zero for free delivery.' });
  if (rule.mode === 'manual_quote' && (rule.charge_cents !== null || rule.free_above_cents !== null))
    ctx.addIssue({ code: 'custom', message: 'Manual quotations cannot promise a charge or free-delivery threshold.' });
  if (new Set(rule.countries).size !== rule.countries.length)
    ctx.addIssue({ code: 'custom', path: ['countries'], message: 'Destination countries must be unique.' });
});

export const storeConfigSchema = z.strictObject({
  version: z.literal(1),
  categories: z.array(z.string().trim().min(1).max(80)).max(50),
  additional_currencies: z.array(currency).max(20),
  delivery_scope: z.enum(['domestic_only', 'domestic_and_international']),
  courier_rules: z.array(courierRuleSchema).max(50),
  payment_methods: z.array(z.enum(['card', 'bank_transfer', 'cash_on_delivery', 'payment_link', 'wallet', 'buy_now_pay_later', 'custom'])).max(7),
  faqs: z.strictObject({
    products: z.string().max(4000), delivery: z.string().max(4000),
    payment: z.string().max(4000), returns: z.string().max(4000), warranty: z.string().max(4000),
  }),
}).superRefine((config, ctx) => {
  for (const key of ['categories', 'additional_currencies', 'payment_methods'] as const)
    if (new Set(config[key]).size !== config[key].length)
      ctx.addIssue({ code: 'custom', path: [key], message: 'Duplicate entries are not allowed.' });
  if (new Set(config.courier_rules.map(rule => rule.id)).size !== config.courier_rules.length)
    ctx.addIssue({ code: 'custom', path: ['courier_rules'], message: 'Courier rule IDs must be unique.' });
  if (config.delivery_scope === 'domestic_only' && config.courier_rules.some(rule => rule.scope === 'international'))
    ctx.addIssue({ code: 'custom', path: ['courier_rules'], message: 'Enable international delivery before configuring international rates.' });
});
export type StoreConfig = z.infer<typeof storeConfigSchema>;

/** Locale facts are resolved from the authenticated organization's row, not a flow. */
export const storeLocaleSchema = z.strictObject({
  country_code: country,
  currency,
  timezone: z.string().min(1).max(100).refine(value => {
    try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); return true; }
    catch { return false; }
  }, 'Choose a valid time zone.'),
});
export type StoreLocale = z.infer<typeof storeLocaleSchema>;

/** Empty means unconfigured, never free delivery or a fabricated return policy. */
export function emptyStoreConfig(): StoreConfig {
  return { version: 1, categories: [], additional_currencies: [], delivery_scope: 'domestic_only',
    courier_rules: [], payment_methods: [], faqs: { products: '', delivery: '', payment: '', returns: '', warranty: '' } };
}

export const productTemplateSchema = z.strictObject({
  sku: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(80), description: z.string().max(4000),
  price_cents: cents, currency, stock: z.number().int().nonnegative().nullable(),
  variants: z.array(z.strictObject({
    sku: z.string().trim().min(1).max(100), name: z.string().trim().min(1).max(200),
    price_cents: cents, stock: z.number().int().nonnegative().nullable(),
  })).max(100),
  media: z.array(z.strictObject({ kind: z.enum(['image', 'video']), url: httpsUrl })).max(10),
  product_link: httpsUrl.nullable(),
}).superRefine((product, ctx) => {
  const skus = [product.sku, ...product.variants.map(variant => variant.sku)];
  if (new Set(skus).size !== skus.length)
    ctx.addIssue({ code: 'custom', path: ['variants'], message: 'Each product and variant needs a distinct SKU.' });
});
