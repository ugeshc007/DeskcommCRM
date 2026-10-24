import type pg from 'pg';
import { z } from 'zod';
import { productTemplateSchema, storeConfigSchema } from './config';

export const storeManagementSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('settings'), revision: z.number().int().nonnegative(), active: z.boolean(),
    automated_checkout: z.boolean().default(false),
    config: storeConfigSchema, prices_include_all_taxes: z.boolean(), payment_connection_id: z.uuid().nullable(),
    reservation_minutes: z.number().int().min(30).max(1440) }),
  z.strictObject({ operation: z.literal('product'), revision: z.number().int().nonnegative(), active: z.boolean(), product: productTemplateSchema }),
]);

export async function manageStore(pool: Pick<pg.Pool, 'connect'>, org: string, actor: string, raw: unknown) {
  z.uuid().parse(org); z.uuid().parse(actor);
  const input = storeManagementSchema.parse(raw), db = await pool.connect();
  try {
    await db.query('begin'); await db.query("set local lock_timeout='5s'"); await db.query("set local statement_timeout='15s'");
    const member = await db.query("select user_id from public.user_organizations where organization_id=$1 and user_id=$2 and role='admin' and accepted_at is not null and revoked_at is null for share", [org, actor]);
    if (!member.rowCount) throw new Error('store_forbidden');
    // Sérialise les écritures de catalogue/configuration de cette organisation.
    await db.query('select id from public.organizations where id=$1 for update', [org]);
    if (input.operation === 'settings') {
      const old = await db.query('select revision from public.store_settings where organization_id=$1 for update', [org]);
      if ((old.rows[0]?.revision ?? 0) !== input.revision) throw new Error('store_revision_conflict');
      if (input.payment_connection_id) {
        const c = await db.query("select id from public.integration_connections where organization_id=$1 and id=$2 and provider='stripe' for share", [org, input.payment_connection_id]);
        if (!c.rowCount) throw new Error('store_payment_connection_unavailable');
      }
      if (input.active && (!input.payment_connection_id || !input.prices_include_all_taxes)) throw new Error('store_checkout_not_configured');
      await db.query(`insert into public.store_settings(organization_id,revision,active,config,prices_include_all_taxes,payment_connection_id,reservation_minutes,automated_checkout)
        values($1,$2,$3,$4::jsonb,$5,$6,$7,$8) on conflict(organization_id) do update set revision=excluded.revision,
        active=excluded.active,config=excluded.config,prices_include_all_taxes=excluded.prices_include_all_taxes,
        payment_connection_id=excluded.payment_connection_id,reservation_minutes=excluded.reservation_minutes,automated_checkout=excluded.automated_checkout,updated_at=now()`,
      [org, input.revision + 1, input.active, JSON.stringify(input.config), input.prices_include_all_taxes, input.payment_connection_id, input.reservation_minutes, input.automated_checkout]);
    } else {
      // Chaque variante garde son propre SKU et sa propre ligne d'inventaire.
      if (input.product.variants.length) throw new Error('store_variant_separate_sku');
      const old = await db.query('select revision,stock_reserved from public.store_products where organization_id=$1 and sku=$2 for update', [org, input.product.sku]);
      if ((old.rows[0]?.revision ?? 0) !== input.revision) throw new Error('store_revision_conflict');
      const held = old.rows[0]?.stock_reserved ?? 0;
      if (held > 0 && (input.product.stock === null || input.product.stock < held || !input.active)) throw new Error('store_inventory_reserved');
      await db.query(`insert into public.store_products(organization_id,sku,revision,active,product,stock_on_hand)
        values($1,$2,$3,$4,$5::jsonb,$6) on conflict(organization_id,sku) do update set revision=excluded.revision,
        active=excluded.active,product=excluded.product,stock_on_hand=excluded.stock_on_hand,updated_at=now()`,
      [org, input.product.sku, input.revision + 1, input.active, JSON.stringify(input.product), input.product.stock]);
    }
    await db.query("insert into public.api_audit_log(organization_id,actor_user_id,action,resource_type,metadata,bypassed_rls) values($1,$2,'store.configuration_updated','store',$3::jsonb,true)", [org, actor, JSON.stringify({ operation: input.operation, revision: input.revision + 1 })]);
    await db.query('commit'); return { revision: input.revision + 1 };
  } catch (error) { await db.query('rollback'); throw error; }
  finally { db.release(); }
}
