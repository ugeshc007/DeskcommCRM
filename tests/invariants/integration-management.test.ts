import { randomUUID, randomBytes } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';
if (!process.env.TEST_DB_CONTAINER) throw new Error('Run through scripts/test-db.sh');
const pool = new pg.Pool({ connectionString: `postgresql://postgres:postgres@127.0.0.1:${Number(process.env.TEST_DB_PORT ?? 54329)}/postgres` });
afterAll(() => pool.end());
async function fixture() {
 const org=randomUUID(), actor=randomUUID(), id=randomUUID();
 await pool.query('insert into organizations(id,slug,legal_name,display_name) values($1,$2::text,$2::text,$2::text)',[org,`synthetic-${org}`]);
 await pool.query('insert into auth.users(id,email) values($1,$2)',[actor,`${actor}@synthetic.test`]);
 await pool.query("insert into user_organizations(user_id,organization_id,role,accepted_at) values($1,$2,'admin',now())",[actor,org]);
 const manage=async(revision:number,op:string,oauth=false,verified=false)=> (await pool.query('select fn_integration_manage($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) result',[org,actor,id,revision,oauth?'google_sheets':'webhook','Synthetic',oauth?'oauth':'api_key',op,oauth?null:Buffer.from('sealed'),oauth?null:Buffer.alloc(12),oauth?null:Buffer.alloc(16),verified])).rows[0].result;
 return {org,actor,id,manage};
}
describe('connection management authority and OAuth state',()=>{
 it('creates inactive, validates, rotates with CAS and disconnects without retaining secrets',async()=>{
  const f=await fixture(); expect(await f.manage(0,'save')).toMatchObject({revision:1,active:false});
  expect(await f.manage(1,'test',false,true)).toMatchObject({revision:1,active:true});
  expect(await f.manage(1,'save')).toMatchObject({revision:2,active:false});
  await expect(f.manage(1,'save')).rejects.toMatchObject({code:'40001'});
  expect(await f.manage(2,'disconnect')).toMatchObject({revision:3,active:false});
  expect((await pool.query('select * from integration_credentials where organization_id=$1',[f.org])).rowCount).toBe(0);
 });
 it('rejects revoked administrators and foreign organization actors',async()=>{
  const a=await fixture(),b=await fixture();await a.manage(0,'save');
  await expect(pool.query("select fn_integration_manage($1,$2,$3,1,'webhook','Synthetic','api_key','disconnect')",[a.org,b.actor,a.id])).rejects.toMatchObject({code:'42501'});
  await pool.query('update user_organizations set revoked_at=now() where user_id=$1',[a.actor]);
  await expect(a.manage(1,'disconnect')).rejects.toMatchObject({code:'42501'});
 });
 it('binds OAuth to the browser, consumes once and checks current membership',async()=>{
  const f=await fixture(); await f.manage(0,'save',true);
  const state=randomBytes(32).toString('hex'),browser=randomBytes(32).toString('hex');
  const insert=()=>pool.query("insert into integration_oauth_states values($1,$2,$3,$4,1,$5,'{}',now()+interval '10 minutes')",[state,f.org,f.id,f.actor,browser]);
  const consume=async(b:string)=>(await pool.query('select fn_integration_oauth_consume($1,$2) result',[state,b])).rows[0].result;
  await insert();expect(await consume('0'.repeat(64))).toBeNull();
  expect(await consume(browser)).toMatchObject({organization_id:f.org,connection_id:f.id});expect(await consume(browser)).toBeNull();
  await insert();await pool.query('update user_organizations set revoked_at=now() where user_id=$1',[f.actor]);expect(await consume(browser)).toBeNull();
 });
 it('does not expose OAuth state or mutation functions to browser roles',async()=>{
  for(const role of ['anon','authenticated']) {
   const client=await pool.connect();
   try {
    await client.query('begin');await client.query(`set local role ${role}`);
    await expect(client.query('select * from integration_oauth_states')).rejects.toMatchObject({code:'42501'});
   } finally {await client.query('rollback');client.release();}
   expect((await pool.query("select has_table_privilege($1,'integration_oauth_states','SELECT') allowed",[role])).rows[0].allowed).toBe(false);
   expect((await pool.query("select has_function_privilege($1,'fn_integration_oauth_consume(text,text)','EXECUTE') allowed",[role])).rows[0].allowed).toBe(false);
  }
 });
});
