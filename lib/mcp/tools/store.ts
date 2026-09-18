import { z } from 'zod';
import type { McpToolDefinition } from '../types';
import { productTemplateSchema } from '@/lib/ecommerce/config';

const inputShape = { query: z.string().trim().min(1).max(100), limit: z.number().int().min(1).max(20).default(10) };
export const crmSearchStoreProducts: McpToolDefinition<typeof inputShape> = {
  name: 'crm_search_store_products', category: 'read', requiresRole: 'agent', requiresScope: 'mcp:read',
  description: 'Search this organization’s native store catalogue for exact prices, SKU, stock available after reservations, media and product links. Never invent missing prices or availability. This does not reserve stock or place an order.',
  inputSchema: inputShape,
  async handler(input, ctx) {
    const setting = await ctx.supabase.from('store_settings').select('active').eq('organization_id', ctx.organizationId).maybeSingle();
    if (setting.error || !setting.data?.active) return { products: [], needs_human: true, message: 'The organization store is not configured or enabled. Ask a human to verify the catalogue.' };
    // Filtrage sans syntaxe PostgREST fournie par le modèle. Recherche bornée et
    // déterministe; ne pas déclarer une absence si le catalogue est tronqué.
    const result = await ctx.supabase.from('store_products').select('sku,product,stock_on_hand,stock_reserved', { count: 'exact' })
      .eq('organization_id', ctx.organizationId).eq('active', true).order('sku').limit(1000);
    if (result.error) return { products: [], needs_human: true, message: 'Catalogue lookup failed. Do not quote remembered prices.' };
    const term = input.query.toLocaleLowerCase('en');
    const products = (result.data ?? []).flatMap(row => {
      const parsed = productTemplateSchema.safeParse(row.product);
      if (!parsed.success) return [];
      const p = parsed.data;
      if (![row.sku, p.name, p.category, p.description].some(value => String(value).toLocaleLowerCase('en').includes(term))) return [];
      return [{ sku: row.sku, name: p.name, category: p.category, description: p.description,
        price_cents: p.price_cents, currency: p.currency,
        available_stock: row.stock_on_hand === null ? null : row.stock_on_hand - row.stock_reserved,
        media: p.media, product_link: p.product_link }];
    }).slice(0, input.limit);
    return { products, partial: result.count === null || result.count > (result.data?.length ?? 0),
      message: 'Prices and available stock are a snapshot, not a reservation. Confirm the chosen SKU and quantity; checkout must recalculate before reserving.' };
  },
};
