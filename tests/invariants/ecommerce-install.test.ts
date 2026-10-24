import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { installStoreDraft } from '@/lib/ecommerce/install';
import { emptyStoreConfig } from '@/lib/ecommerce/config';
if (!process.env.TEST_DB_CONTAINER) throw new Error('Run through scripts/test-db.sh');
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres` });
afterAll(() => pool.end());
async function fixture() {
  const org = randomUUID(), actor = randomUUID(), channel = randomUUID();
  await pool.query(`insert into organizations(id,slug,legal_name,display_name,currency,timezone,onboarding_state,settings)
    values($1,$2::text,$2::text,$2::text,'AED','Asia/Dubai','{"welcome":{"country_code":"AE"}}','{"keep":"unchanged"}')`, [org, `synthetic-${org}`]);
  await pool.query('insert into auth.users(id,email) values($1,$2)', [actor, `${actor}@synthetic.test`]);
  await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'admin',now())", [actor, org]);
  await pool.query("insert into channel_sessions(id,organization_id,waha_session_name,webhook_secret_encrypted) values($1,$2,$3,'\\x00')", [channel, org, `synthetic-${channel}`]);
  const input = { channel_session_id: channel, provider: 'openai', model: 'synthetic-model', credential_id: null, config: emptyStoreConfig() };
  const originalStages = (await pool.query('select * from crm_stages where organization_id=$1 order by id', [org])).rows;
  const originalSettings = (await pool.query('select settings from organizations where id=$1', [org])).rows[0].settings;
  return { org, actor, channel, input, originalStages, originalSettings, install: () => installStoreDraft(pool, org, actor, input) };
}
describe('draft store installation transaction', () => {
  it('installs isolated drafts once under concurrent requests and preserves settings', async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([f.install(), f.install()]);
    expect(a.receipt).toEqual(b.receipt); expect([a.created, b.created].sort()).toEqual([false, true]);
    const agent = (await pool.query('select * from ai_agents where organization_id=$1', [f.org])).rows;
    expect(agent).toHaveLength(1); expect(agent[0]).toMatchObject({ is_active: false, published_version_id: null, is_default: false });
    const version = (await pool.query('select * from ai_agent_versions where organization_id=$1', [f.org])).rows[0];
    expect(version).toMatchObject({ status: 'draft', published_at: null, channel_session_id: f.channel, handoff_tool_enabled: true });
    expect(version.system_prompt).toContain('AED'); expect(version.system_prompt).toContain('English');
    const flow = (await pool.query('select * from followup_flow_pointers where organization_id=$1', [f.org])).rows[0];
    expect(flow).toMatchObject({ status: 'draft', active_version_id: null, trigger_config: { kind: 'manual' } });
    expect((await pool.query('select * from crm_stages where organization_id=$1 and pipeline_id=$2', [f.org, a.receipt.pipeline_id])).rowCount).toBe(7);
    expect((await pool.query('select * from crm_stages where organization_id=$1 and pipeline_id<>$2 order by id', [f.org, a.receipt.pipeline_id])).rows).toEqual(f.originalStages);
    expect((await pool.query('select settings from organizations where id=$1', [f.org])).rows[0].settings.keep).toBe('unchanged');
    expect((await pool.query("select * from api_audit_log where organization_id=$1 and action='ecommerce.template_installed'", [f.org])).rowCount).toBe(1);
  });
  it('rejects a foreign administrator, channel and revoked membership', async () => {
    const a = await fixture(), b = await fixture();
    await expect(installStoreDraft(pool, a.org, b.actor, a.input)).rejects.toThrow('store_forbidden');
    await expect(installStoreDraft(pool, a.org, a.actor, { ...a.input, channel_session_id: b.channel })).rejects.toThrow('store_channel_required');
    await pool.query('update user_organizations set revoked_at=now() where user_id=$1', [a.actor]);
    await expect(a.install()).rejects.toThrow('store_forbidden');
    expect((await pool.query('select * from ai_agents where organization_id=$1', [a.org])).rowCount).toBe(0);
  });
  it('rolls back all preceding writes on an existing flow name and does not overwrite it', async () => {
    const f = await fixture();
    const tables = ['ai_agents', 'ai_agent_versions', 'crm_pipelines', 'crm_stages'];
    const original = await Promise.all(tables.map(async table => (await pool.query(`select * from ${table} where organization_id=$1 order by id`, [f.org])).rows));
    await pool.query("insert into followup_flow_pointers(organization_id,name) values($1,'Store enquiry')", [f.org]);
    await expect(f.install()).rejects.toMatchObject({ code: '23505' });
    for (const [index, table] of tables.entries())
      expect((await pool.query(`select * from ${table} where organization_id=$1 order by id`, [f.org])).rows).toEqual(original[index]);
    expect((await pool.query('select settings from organizations where id=$1', [f.org])).rows[0].settings).toEqual(f.originalSettings);
  });
  it('does not guess missing regional settings or trust a foreign receipt', async () => {
    const a = await fixture(), b = await fixture();
    await pool.query("update organizations set onboarding_state='{}' where id=$1", [a.org]);
    await expect(a.install()).rejects.toThrow('store_region_required');
    const installed = await b.install();
    await pool.query("update organizations set settings=jsonb_build_object('ecommerce_template',$2::jsonb) where id=$1", [a.org, JSON.stringify(installed.receipt)]);
    await expect(a.install()).rejects.toThrow('store_receipt_conflict');
  });
});
