import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { z } from 'zod';
import { PROVIDERS } from '@/lib/ai/agents/validation';
import { PROVIDERS_DE_MENSAGEM } from '@/lib/channels/capabilities';
import { storeConfigSchema, storeLocaleSchema } from './config';
import { createStoreEnquiryFlow, storeSalesPrompt, STORE_SALES_STAGES } from './template';

export const storeInstallSchema = z.strictObject({
  channel_session_id: z.uuid(), provider: z.enum(PROVIDERS),
  model: z.string().trim().min(1).max(120), credential_id: z.uuid().nullable(),
  config: storeConfigSchema,
});
export const storeReceiptSchema = z.strictObject({
  version: z.literal(1), agent_id: z.uuid(), version_id: z.uuid(),
  pipeline_id: z.uuid(), flow_id: z.uuid(), installed_at: z.iso.datetime(),
});
export type StoreReceipt = z.infer<typeof storeReceiptSchema>;

/** One transaction over existing generic CRM primitives; no niche table or live bot.
 * The caller supplies authenticated scope. Membership is checked again under lock.
 */
export async function installStoreDraft(pool: Pick<pg.Pool, 'connect'>, organizationId: string, actorId: string, raw: unknown) {
  z.uuid().parse(organizationId); z.uuid().parse(actorId);
  const input = storeInstallSchema.parse(raw);
  const db = await pool.connect();
  try {
    await db.query('begin');
    await db.query("set local statement_timeout='15s'");
    await db.query("set local lock_timeout='5s'");
    const member = await db.query("select user_id from public.user_organizations where organization_id=$1 and user_id=$2 and role='admin' and revoked_at is null and accepted_at is not null for share", [organizationId, actorId]);
    if (!member.rowCount) throw new Error('store_forbidden');
    const result = await db.query<{settings: Record<string, unknown>; onboarding_state: {welcome?: {country_code?: string}}; currency: string; timezone: string}>(
      'select settings,onboarding_state,currency,timezone from public.organizations where id=$1 for update', [organizationId]);
    const org = result.rows[0];
    if (!org) throw new Error('store_forbidden');
    if (org.settings?.ecommerce_template) {
      const receipt = storeReceiptSchema.parse(org.settings.ecommerce_template);
      // A settings value alone is not authority to expose another organization's IDs.
      const owned = await db.query(`select a.id from public.ai_agents a
        join public.ai_agent_versions v on v.organization_id=a.organization_id and v.agent_id=a.id and v.id=$3
        join public.crm_pipelines p on p.organization_id=a.organization_id and p.id=$4
        join public.followup_flow_pointers f on f.organization_id=a.organization_id and f.id=$5
        where a.organization_id=$1 and a.id=$2`, [organizationId, receipt.agent_id, receipt.version_id, receipt.pipeline_id, receipt.flow_id]);
      if (!owned.rowCount) throw new Error('store_receipt_conflict');
      await db.query('commit');
      return { receipt, created: false };
    }
    const regional = storeLocaleSchema.safeParse({ country_code: org.onboarding_state?.welcome?.country_code, currency: org.currency, timezone: org.timezone });
    if (!regional.success) throw new Error('store_region_required');
    const channel = await db.query('select id from public.channel_sessions where organization_id=$1 and id=$2 and archived_at is null and provider=any($3::text[]) for share', [organizationId, input.channel_session_id, [...PROVIDERS_DE_MENSAGEM]]);
    if (!channel.rowCount) throw new Error('store_channel_required');
    if (input.credential_id) {
      const credential = await db.query('select id from public.ai_provider_credentials where organization_id=$1 and id=$2 and provider=$3 for share', [organizationId, input.credential_id, input.provider]);
      if (!credential.rowCount) throw new Error('store_credential_required');
    }
    const prompt = storeSalesPrompt(input.config, regional.data);
    if (prompt.length > 20000) throw new Error('store_policy_too_long');
    const receipt: StoreReceipt = { version: 1, agent_id: randomUUID(), version_id: randomUUID(), pipeline_id: randomUUID(), flow_id: randomUUID(), installed_at: new Date().toISOString() };
    const vocabulary = { lead: 'Customer', lead_plural: 'Customers', deal: 'Order', deal_plural: 'Orders', won: 'Paid', lost: 'Cancelled', stage: 'Stage', stage_plural: 'Stages' };
    await db.query(`insert into public.crm_pipelines(id,organization_id,name,slug,description,is_default,vocabulary)
      values($1,$2,'Sales','store-sales','Store template sales enquiries',false,$3::jsonb)`, [receipt.pipeline_id, organizationId, JSON.stringify(vocabulary)]);
    for (const [index, stage] of STORE_SALES_STAGES.entries()) {
      await db.query(`insert into public.crm_stages(organization_id,pipeline_id,name,slug,position,is_won,is_lost,agent_stage_hint)
        values($1,$2,$3,$4,$5,$6,$7,$4)`, [organizationId, receipt.pipeline_id, stage.name, stage.hint, (index + 1) * 1000, stage.hint === 'won', stage.hint === 'lost']);
    }
    await db.query(`insert into public.ai_agents(id,organization_id,name,description,model,system_prompt,is_active,is_default,kind,created_by)
      values($1,$2,'Store sales assistant','Draft store template. Review products, policies and model before publishing.',$3,$4,false,false,'mcp_agent',$5)`,
    [receipt.agent_id, organizationId, `${input.provider}/${input.model}`, prompt, actorId]);
    await db.query(`insert into public.ai_agent_versions(id,organization_id,agent_id,version_number,system_prompt,provider,model,credential_id,tool_ids,channel_session_id,handoff_keywords,handoff_tool_enabled,status,created_by,pipeline_ids)
      values($1,$2,$3,1,$4,$5,$6,$7,array['crm_search_store_products','crm_quote_store_checkout','crm_confirm_store_checkout','crm_store_order_status'],$8,array['human','person','customer service'],true,'draft',$9,array[$10::uuid])`,
    [receipt.version_id, organizationId, receipt.agent_id, prompt, input.provider, input.model, input.credential_id, input.channel_session_id, actorId, receipt.pipeline_id]);
    await db.query(`insert into public.followup_flow_pointers(id,organization_id,name,status,draft_graph,handoff_policy,trigger_config)
      values($1,$2,'Store enquiry','draft',$3::jsonb,'pause','{"kind":"manual"}'::jsonb)`, [receipt.flow_id, organizationId, JSON.stringify(createStoreEnquiryFlow())]);
    await db.query("update public.organizations set settings=coalesce(settings,'{}'::jsonb) || jsonb_build_object('ecommerce_template',$2::jsonb) where id=$1", [organizationId, JSON.stringify(receipt)]);
    // Audit is in the same transaction: rollback cannot leave an installation event.
    await db.query(`insert into public.api_audit_log(organization_id,actor_user_id,action,resource_type,resource_id,metadata,bypassed_rls)
      values($1,$2,'ecommerce.template_installed','ai_agent',$3,$4::jsonb,true)`, [organizationId, actorId, receipt.agent_id, JSON.stringify({ version: 1, pipeline_id: receipt.pipeline_id, flow_id: receipt.flow_id, draft_only: true })]);
    await db.query('commit');
    return { receipt, created: true };
  } catch (error) {
    await db.query('rollback');
    throw error;
  } finally { db.release(); }
}
