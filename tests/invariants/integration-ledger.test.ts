import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { z } from 'zod';
vi.mock('@/lib/env', () => ({ env: { AI_CRED_AES_KEY: Buffer.alloc(32, 8).toString('base64') } }));
import { createPostgresIntegrationStore } from '@/lib/integrations/postgres-store';
import { sealCredential } from '@/lib/integrations/vault';
import { executeIntegration, type ConnectorAction } from '@/lib/integrations/execution';
import { recordInboundEvent } from '@/lib/integrations/inbound';

if (!process.env.TEST_DB_CONTAINER) throw new Error('Run through scripts/test-db.sh');
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres` });
afterAll(() => pool.end());
const store = createPostgresIntegrationStore(pool);

async function fixture() {
  const organizationId = randomUUID(); const connectionId = randomUUID();
  await pool.query('insert into organizations(id,slug,legal_name,display_name) values($1,$2::text,$2::text,$2::text)', [organizationId, `integration-${organizationId}`]);
  await pool.query("insert into integration_connections(id,organization_id,provider,label,active) values($1,$2,'synthetic','Synthetic connection',true)", [connectionId, organizationId]);
  const identity = { organizationId, connectionId, revision: 1 };
  const sealed = sealCredential(identity, 'synthetic-credential');
  await pool.query('insert into integration_credentials(connection_id,organization_id,revision,ciphertext,iv,tag) values($1,$2,1,$3,$4,$5)', [connectionId, organizationId, sealed.ciphertext, sealed.iv, sealed.tag]);
  const scope = { organizationId, executionKey: randomUUID() };
  return { ...identity, scope, request: { connectionId, revision: 1, action: 'read_item', input: {} } };
}
const action = (execute: ConnectorAction['execute']): ConnectorAction => ({ provider: 'synthetic', action: 'read_item', retry: 'read_only', input: z.strictObject({}), output: z.strictObject({ item: z.string() }), execute });

describe('integration ledger and vault on the real baseline', () => {
  it('isolates received events by both organization and connection', async () => {
    const a=await fixture(),b=await fixture();
    const event={id:'synthetic-event',event:'stock.updated',data:{stock:5}};
    expect(await recordInboundEvent(store,a.organizationId,{id:a.connectionId,revision:1},event)).toBe('recorded');
    expect(await recordInboundEvent(store,a.organizationId,{id:a.connectionId,revision:1},event)).toBe('duplicate');
    expect(await recordInboundEvent(store,a.organizationId,{id:a.connectionId,revision:1},{...event,data:{stock:6}})).toBe('conflict');
    expect(await store.readEvent!(a.organizationId,a.connectionId,event.id)).toEqual(event);
    expect(await store.readEvent!(b.organizationId,a.connectionId,event.id)).toBeNull();
    expect(await store.readEvent!(a.organizationId,b.connectionId,event.id)).toBeNull();
  });
  it('runs exactly once under concurrent claims and replays its projected result', async () => {
    const f = await fixture(); const execute = vi.fn(async () => ({ item: 'synthetic' }));
    const results = await Promise.all(Array.from({ length: 8 }, () => executeIntegration(f.scope, f.request, [action(execute)], store)));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(results.some(r => r.status === 'succeeded')).toBe(true);
    expect(await executeIntegration(f.scope, f.request, [action(execute)], store)).toEqual({ status: 'succeeded', output: { item: 'synthetic' }, replayed: true });
    const rows = (await pool.query('select status,output from integration_executions where organization_id=$1', [f.organizationId])).rows;
    expect(rows).toEqual([{ status: 'succeeded', output: { item: 'synthetic' } }]);
  });
  it('blocks a foreign organization before credentials or the adapter', async () => {
    const a = await fixture(); const b = await fixture(); const execute = vi.fn(async () => ({ item: 'x' }));
    expect(await executeIntegration(b.scope, a.request, [action(execute)], store)).toMatchObject({ code: 'connection_unavailable' });
    await expect(store.withCredential(b.organizationId, a.connectionId, 1, async value => value)).rejects.toThrow('integration_credential_unavailable');
    expect(execute).not.toHaveBeenCalled();
    await expect(pool.query('update integration_credentials set organization_id=$1 where connection_id=$2', [b.organizationId, a.connectionId])).rejects.toMatchObject({ code: '23503' });
  });
  it('conflicts on a different fingerprint and refuses forged or terminal leases', async () => {
    const f = await fixture(); const identity = { ...f.request };
    const claim = await store.claim(f.scope, 'a'.repeat(64), 'never', identity);
    expect(claim.kind).toBe('acquired'); if (claim.kind !== 'acquired') throw new Error('claim');
    expect(await store.claim(f.scope, 'b'.repeat(64), 'never', identity)).toEqual({ kind: 'conflict' });
    await expect(store.finish(f.scope, randomUUID(), { status: 'failed', code: 'provider_rejected' })).rejects.toMatchObject({ code: '40001' });
    const foreign = await fixture();
    await expect(store.finish({ ...f.scope, organizationId: foreign.organizationId }, claim.lease, { status: 'failed', code: 'provider_rejected' })).rejects.toMatchObject({ code: '40001' });
    await store.finish(f.scope, claim.lease, { status: 'failed', code: 'provider_rejected' });
    expect(await store.claim(f.scope, 'a'.repeat(64), 'never', identity)).toEqual({ kind: 'failed', code: 'provider_rejected' });
    await expect(store.finish(f.scope, claim.lease, { status: 'succeeded', output: {} })).rejects.toMatchObject({ code: '40001' });
  });
  it('does not repeat uncertain effects or persist diagnostic secrets', async () => {
    const f = await fixture(); const execute = vi.fn(async () => { throw new Error('synthetic-credential: remote response'); });
    await executeIntegration(f.scope, f.request, [action(execute)], store);
    expect(await executeIntegration(f.scope, f.request, [action(execute)], store)).toEqual({ status: 'pending', code: 'reconciliation_required' });
    expect(execute).toHaveBeenCalledTimes(1);
    const row = (await pool.query('select * from integration_executions where organization_id=$1', [f.organizationId])).rows[0];
    expect(row.status).toBe('indeterminate'); expect(JSON.stringify(row)).not.toContain('synthetic-credential');
  });
  it('does not reclaim an old pending job merely because time passed', async () => {
    const f = await fixture(); const identity = { ...f.request };
    await store.claim(f.scope, 'a'.repeat(64), 'never', identity);
    await pool.query("update integration_executions set created_at=now()-interval '1 day' where organization_id=$1", [f.organizationId]);
    expect(await store.claim(f.scope, 'a'.repeat(64), 'never', identity)).toEqual({ kind: 'busy' });
  });
  it('rejects old revisions and disconnected credentials', async () => {
    const f = await fixture();
    await pool.query('update integration_connections set revision=2 where organization_id=$1 and id=$2', [f.organizationId, f.connectionId]);
    await expect(store.withCredential(f.organizationId, f.connectionId, 1, async v => v)).rejects.toThrow();
    await expect(store.withCredential(f.organizationId, f.connectionId, 2, async v => v)).rejects.toThrow();
    await pool.query('update integration_connections set revision=1,active=false where organization_id=$1 and id=$2', [f.organizationId, f.connectionId]);
    await expect(store.withCredential(f.organizationId, f.connectionId, 1, async v => v)).rejects.toThrow();
  });
  it('restricts metadata by organization and hides it from viewers', async () => {
    const a = await fixture(); await fixture(); const user = randomUUID();
    await pool.query('insert into auth.users(id,email) values($1,$2)', [user, `${user}@synthetic.test`]);
    await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'manager',now())", [user, a.organizationId]);
    const client = await pool.connect();
    try {
      await client.query('begin'); await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user })]);
      expect((await client.query('select id from integration_connections')).rows).toEqual([{ id: a.connectionId }]);
      await client.query('rollback');
      await pool.query("update user_organizations set role='viewer' where user_id=$1 and organization_id=$2", [user, a.organizationId]);
      await client.query('begin'); await client.query('set local role authenticated');
      await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user })]);
      expect((await client.query('select id from integration_connections')).rows).toEqual([]);
    } finally { await client.query('rollback'); client.release(); }
  });
  it('revokes default ACL access to secrets, results, mutation and RPCs', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['integration_credentials', 'integration_executions']) {
        const client = await pool.connect();
        try {
          await client.query('begin');
          await client.query(`set local role ${role}`);
          await expect(client.query(`select * from public.${table}`)).rejects.toMatchObject({ code: '42501' });
        } finally { await client.query('rollback'); client.release(); }
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'])
          expect((await pool.query('select has_table_privilege($1,$2,$3) allowed', [role, `public.${table}`, privilege])).rows[0].allowed).toBe(false);
      }
      for (const fn of ['fn_integration_claim(uuid,text,uuid,integer,text,text,text)', 'fn_integration_finish(uuid,text,uuid,text,jsonb,text)'])
        expect((await pool.query('select has_function_privilege($1,$2,$3) allowed', [role, `public.${fn}`, 'EXECUTE'])).rows[0].allowed).toBe(false);
    }
    expect((await pool.query("select has_table_privilege('service_role','public.integration_executions','UPDATE') allowed")).rows[0].allowed).toBe(false);
  });
});
