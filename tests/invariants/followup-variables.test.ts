import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { criarOrigemDeFollowup } from './followup-service-origin';

if (!process.env.TEST_DB_CONTAINER) throw new Error('Run through scripts/test-db.sh');
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres` });
afterAll(() => pool.end());

async function fixture() {
  const org = randomUUID();
  await pool.query('insert into organizations(id,slug,legal_name,display_name) values($1,$2::text,$2::text,$2::text)', [org, `variables-${org}`]);
  const contact = (await pool.query('insert into contacts(organization_id,name) values($1,$2) returning id', [org, 'Synthetic contact'])).rows[0].id;
  const boundary = await criarOrigemDeFollowup(pool, org, contact);
  const graph = { nodes: [{ id: 'set', type: 'action', config: { mode: 'set_variable', key: 'score', value_type: 'number', expression: { kind: 'literal', value: 1 } } }, { id: 'end', type: 'end', config: { outcome: 'custom' } }], edges: [{ source: 'set', target: 'end', condition: { type: 'always' } }] };
  const version = (await pool.query('insert into followup_flow_versions(organization_id,graph) values($1,$2) returning id', [org, graph])).rows[0].id;
  const pointer = (await pool.query("insert into followup_flow_pointers(organization_id,name,status,active_version_id) values($1,'Variables','active',$2) returning id", [org, version])).rows[0].id;
  const row = (await pool.query(`insert into followup_enrollments(organization_id,pointer_id,version_id,contact_id,conversation_id,service_boundary,current_node_id,status)
    values($1,$2,$3,$4,$5,$6,'set','active') returning id,revision`, [org, pointer, version, contact, boundary.conversation_id, boundary])).rows[0];
  return { org, ...row, conversation: boundary.conversation_id };
}
async function write(f: Awaited<ReturnType<typeof fixture>>, overrides: { org?: string; type?: string; value?: unknown; key?: string } = {}) {
  return pool.query('select fn_followup_set_variable($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [overrides.org ?? f.org, f.id, f.revision, 'set', 'end', overrides.key ?? 'score', overrides.type ?? 'number', JSON.stringify(overrides.value ?? 7)]);
}
describe('atomic organization-isolated session variables', () => {
  it('writes value, advances and records metadata only in one step', async () => {
    const f = await fixture(); await write(f);
    const row = (await pool.query('select variables,current_node_id,steps_taken from followup_enrollments where organization_id=$1 and id=$2', [f.org, f.id])).rows[0];
    expect(row.variables).toEqual({ score: { type: 'number', value: 7 } });
    expect(row.current_node_id).toBe('end'); expect(row.steps_taken).toBe(1);
    const events = (await pool.query('select payload from followup_enrollment_events where organization_id=$1 and enrollment_id=$2', [f.org, f.id])).rows;
    expect(events).toEqual([{ payload: { key: 'score', value_type: 'number' } }]);
    await expect(write(f)).rejects.toMatchObject({ code: '40001' });
  });
  it('rejects a different organization without writing', async () => {
    const f = await fixture(); const other = await fixture();
    await expect(write(f, { org: other.org })).rejects.toMatchObject({ code: '40001' });
    expect((await pool.query('select variables from followup_enrollments where id=$1', [f.id])).rows[0].variables).toEqual({});
  });
  it('rejects type mismatch and credential names without partial advancement', async () => {
    const f = await fixture();
    await expect(write(f, { value: 'not a number' })).rejects.toMatchObject({ code: '22023' });
    await expect(write(f, { key: 'api_key' })).rejects.toMatchObject({ code: '22023' });
    expect((await pool.query('select current_node_id from followup_enrollments where id=$1', [f.id])).rows[0].current_node_id).toBe('set');
  });
  it('rejects closed service boundaries', async () => {
    const f = await fixture();
    await pool.query("update conversations set status='closed' where organization_id=$1 and id=$2", [f.org, f.conversation]);
    await expect(write(f)).rejects.toMatchObject({ code: '40001' });
  });
  it('rejects oversized text without partial advancement', async () => {
    const f = await fixture();
    await expect(write(f, { type: 'string', value: 'x'.repeat(2001) })).rejects.toMatchObject({ code: '22023' });
    expect((await pool.query('select current_node_id,variables from followup_enrollments where id=$1', [f.id])).rows[0]).toEqual({ current_node_id: 'set', variables: {} });
  });
  it('cannot jump to a node not connected to the current step', async () => {
    const f = await fixture();
    await expect(pool.query('select fn_followup_set_variable($1,$2,$3,$4,$5,$6,$7,$8::jsonb)', [f.org, f.id, f.revision, 'set', 'set', 'score', 'number', '7']))
      .rejects.toMatchObject({ code: '22023' });
    expect((await pool.query('select variables from followup_enrollments where id=$1', [f.id])).rows[0].variables).toEqual({});
  });
  it('does not expose variable mutation RPC to public callers', async () => {
    for (const role of ['anon', 'authenticated']) {
      const allowed = (await pool.query("select has_function_privilege($1,'public.fn_followup_set_variable(uuid,uuid,bigint,text,text,text,text,jsonb)','EXECUTE') allowed", [role])).rows[0].allowed;
      expect(allowed).toBe(false);
    }
  });
});
