import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';

if (!process.env.TEST_DB_CONTAINER) throw new Error('Run through scripts/test-db.sh');
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres` });
afterAll(() => pool.end());
let pageNumber = 900000;
async function fixture() {
  const org = randomUUID(), actor = randomUUID(), connection = randomUUID(), page = String(++pageNumber);
  await pool.query('insert into organizations(id,slug,legal_name,display_name) values($1,$2::text,$2::text,$2::text)', [org, `synthetic-${org}`]);
  await pool.query('insert into auth.users(id,email) values($1,$2)', [actor, `${actor}@synthetic.test`]);
  await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'admin',now())", [actor, org]);
  await pool.query("select fn_integration_manage($1,$2,$3,0,'messenger','Synthetic Page','api_key','save',$4,$5,$6,false)", [org, actor, connection, Buffer.from('sealed'), Buffer.alloc(12), Buffer.alloc(16)]);
  await pool.query("select fn_integration_manage($1,$2,$3,1,'messenger','Synthetic Page','api_key','test',null,null,null,true)", [org, actor, connection]);
  const bind = async (pageId = page, orgId = org, actorId = actor, revision = 1) => (await pool.query('select fn_bind_page_channel($1,$2,$3,$4,$5) id', [orgId, actorId, connection, revision, pageId])).rows[0].id as string;
  const session = await bind();
  const ingest = async (external = randomUUID(), sender = '123456', orgId = org, revision = 1) => (await pool.query("select fn_ingest_page_message($1,$2,$3,$4,$5,now(),'Synthetic hello',null) receipt", [orgId, session, revision, sender, external])).rows[0].receipt;
  return { org, actor, connection, page, session, bind, ingest };
}

describe('native Page channel organization boundary', () => {
  it('redacts provider identity and acknowledges replays without resurrecting a contact', async () => {
    const f = await fixture(), r = await f.ingest();
    await pool.query('update contacts set is_anonymized=true,anonymized_at=now() where organization_id=$1 and id=$2', [f.org, r.contact_id]);
    const identity = (await pool.query('select provider_user_id from channel_contact_identities where organization_id=$1', [f.org])).rows[0].provider_user_id;
    expect(identity).toMatch(/^redacted:[a-f0-9]{64}$/);
    const result = (await pool.query("select fn_ingest_page_message_v3($1,$2,1,'123456',$3,now(),'Hello',null,null,false) receipt", [f.org, f.session, randomUUID()])).rows[0].receipt;
    expect(result).toEqual({ ignored: true });
    expect((await pool.query('select count(*)::int n from contacts where organization_id=$1', [f.org])).rows[0].n).toBe(1);
  });
  it('commits media and recovery work atomically and dispatches once after replay', async () => {
    const f = await fixture(), external = randomUUID();
    const ingest = () => pool.query("select fn_ingest_page_message_v2($1,$2,1,'123456',$3,now(),'Synthetic photo',null,$4,false) receipt", [f.org, f.session, external, { kind: 'image', url: 'https://cdn.example/photo.png' }]);
    const receipt = (await ingest()).rows[0].receipt;
    await ingest();
    const events = (await pool.query("select event_type,count(*)::int count from event_log where organization_id=$1 and entity_id=$2 and event_type in ('channel.inbound_postprocess','media.persist_requested') group by event_type order by event_type", [f.org, receipt.message_id])).rows;
    expect(events).toEqual([{ event_type: 'channel.inbound_postprocess', count: 1 }, { event_type: 'media.persist_requested', count: 1 }]);
    const calls = await Promise.all([pool.query('select fn_dispatch_inbound_once($1,$2) id', [f.org, receipt.message_id]), pool.query('select fn_dispatch_inbound_once($1,$2) id', [f.org, receipt.message_id])]);
    expect(calls[0].rows[0].id).toBe(calls[1].rows[0].id);
    await pool.query("update messages set metadata='{}' where organization_id=$1 and id=$2", [f.org, receipt.message_id]);
    expect((await pool.query('select fn_dispatch_inbound_once($1,$2) id', [f.org, receipt.message_id])).rows[0].id).toBe(calls[0].rows[0].id);
    expect((await pool.query("select count(*)::int n from event_log where organization_id=$1 and entity_id=$2 and event_type='ai_agent.dispatch_requested'", [f.org, receipt.message_id])).rows[0].n).toBe(1);
    const foreign = await fixture();
    await expect(pool.query('select fn_dispatch_inbound_once($1,$2)', [foreign.org, receipt.message_id])).rejects.toThrow('message_unavailable');
  });
  it('blocks opt-out before any worker can dispatch a reply', async () => {
    const f = await fixture();
    const r = (await pool.query("select fn_ingest_page_message_v2($1,$2,1,'123456',$3,now(),'STOP',null,null,true) receipt", [f.org, f.session, randomUUID()])).rows[0].receipt;
    expect((await pool.query('select is_blocked from contacts where organization_id=$1 and id=$2', [f.org, r.contact_id])).rows[0].is_blocked).toBe(true);
    expect((await pool.query('select fn_dispatch_inbound_once($1,$2) id', [f.org, r.message_id])).rows[0].id).toBeNull();
  });
  it('binds idempotently and rejects another organization or actor', async () => {
    const a = await fixture(), b = await fixture();
    expect(await a.bind()).toBe(a.session);
    await expect(a.bind(a.page, a.org, b.actor)).rejects.toMatchObject({ code: '42501' });
    await expect(a.bind(a.page, b.org, b.actor)).rejects.toMatchObject({ code: '40001' });
    await expect(b.bind(a.page)).rejects.toMatchObject({ code: '23505' });
    await expect(a.ingest(randomUUID(), '123456', b.org)).rejects.toMatchObject({ code: '42501' });
  });
  it('deduplicates concurrent delivery without duplicate contacts or unread counts', async () => {
    const f = await fixture(), external = randomUUID();
    const receipts = await Promise.all([f.ingest(external), f.ingest(external)]);
    expect(receipts.filter(r => !r.duplicate)).toHaveLength(1);
    expect(receipts[0].message_id).toBe(receipts[1].message_id);
    const contact = (await pool.query('select phone_number,wa_identity from contacts where organization_id=$1', [f.org])).rows;
    expect(contact).toEqual([{ phone_number: null, wa_identity: null }]);
    expect((await pool.query('select unread_count_for_assignee from conversations where organization_id=$1', [f.org])).rows).toEqual([{ unread_count_for_assignee: 1 }]);
  });
  it('keeps the same provider user isolated across Pages', async () => {
    const a = await fixture(), b = await fixture();
    const ar = await a.ingest(), br = await b.ingest();
    expect(ar.contact_id).not.toBe(br.contact_id);
    expect(ar.conversation_id).not.toBe(br.conversation_id);
  });
  it('suspends after disconnect and rejects stale credential revisions', async () => {
    const f = await fixture();
    await f.ingest();
    await pool.query("select fn_integration_manage($1,$2,$3,1,'messenger','Synthetic Page','api_key','disconnect')", [f.org, f.actor, f.connection]);
    expect((await pool.query('select status from channel_sessions where organization_id=$1 and id=$2', [f.org, f.session])).rows[0].status).toBe('STOPPED');
    await expect(f.ingest()).rejects.toMatchObject({ code: '42501' });
    await expect(f.bind()).rejects.toMatchObject({ code: '40001' });
  });
  it('does not expose identity reads or privileged RPCs to browser roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      expect((await pool.query("select has_table_privilege($1,'channel_contact_identities','SELECT') allowed", [role])).rows[0].allowed).toBe(false);
      for (const fn of ['fn_dispatch_inbound_once(uuid,uuid)', 'fn_ingest_page_message_v2(uuid,uuid,integer,text,text,timestamptz,text,text,jsonb,boolean)', 'fn_bind_page_channel(uuid,uuid,uuid,integer,text)', 'fn_ingest_page_message(uuid,uuid,integer,text,text,timestamptz,text,text)']) {
        expect((await pool.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, fn])).rows[0].allowed).toBe(false);
      }
    }
  });
});
