import { createHmac } from 'node:crypto';
import { beforeEach,expect,it,vi } from 'vitest';
const mocks=vi.hoisted(()=>({db:{from:vi.fn()},read:vi.fn(),record:vi.fn(),rate:vi.fn(),audit:vi.fn()}));
vi.mock('@/lib/supabase/admin',()=>({createAdminClient:()=>mocks.db}));
vi.mock('@/lib/ai/dispatcher/rate-limit',()=>({checkRateLimit:mocks.rate}));
vi.mock('@/lib/integrations/management',()=>({readConnectionCredential:mocks.read}));
vi.mock('@/lib/integrations/supabase-store',()=>({createSupabaseIntegrationStore:()=>({})}));
vi.mock('@/lib/integrations/inbound',async importOriginal=>({...await importOriginal<object>(),recordInboundEvent:mocks.record}));
vi.mock('@/lib/audit',()=>({audit:mocks.audit}));
import { POST } from './route';
const id='33333333-3333-4333-8333-333333333333',org='11111111-1111-4111-8111-111111111111',secret='synthetic-secret-not-real-32-characters';
const connection={id,organization_id:org,provider:'inbound_webhook',revision:1,active:true};
function query(data:unknown){const q={select:vi.fn(),eq:vi.fn(),contains:vi.fn(),limit:vi.fn(),maybeSingle:vi.fn()};q.select.mockReturnValue(q);q.eq.mockReturnValue(q);q.contains.mockReturnValue(q);q.limit.mockResolvedValue({data,error:null});q.maybeSingle.mockResolvedValue({data,error:null});return q;}
function request(payload:unknown,stripe=false,key=secret){const raw=JSON.stringify(payload),time=Math.floor(Date.now()/1000);return new Request('https://example.com/api/v1/webhooks/integrations/'+id,{method:'POST',headers:{[stripe?'stripe-signature':'x-integration-signature']:`t=${time},v1=${createHmac('sha256',key).update(time+'.'+raw).digest('hex')}`},body:raw});}
const ctx={params:Promise.resolve({id})};
beforeEach(()=>{vi.resetAllMocks();mocks.rate.mockResolvedValue({allowed:true});mocks.read.mockResolvedValue(JSON.stringify({signing_secret:secret}));mocks.db.from.mockReturnValue(query(connection));mocks.record.mockResolvedValue('recorded');});
it('takes organization from the connection, not the event',async()=>{
 const r=await POST(request({id:'test1',event:'stock',data:{stock:5}}),ctx);expect(r.status).toBe(200);
 expect(mocks.read).toHaveBeenCalledWith(mocks.db,org,connection);
 expect(mocks.record).toHaveBeenCalledWith({},org,connection,{id:'test1',event:'stock',data:{stock:5}});
});
it('rejects a forged signature before recording',async()=>{expect((await POST(request({id:'test1',event:'stock',data:{}},false,'foreign-secret'),ctx)).status).toBe(403);expect(mocks.record).not.toHaveBeenCalled();});
it('rejects an organization override in the payload',async()=>{expect((await POST(request({id:'test1',event:'stock',data:{},organization_id:'other-org'}),ctx)).status).toBe(422);expect(mocks.record).not.toHaveBeenCalled();});
it('returns a retryable status on indeterminate persistence',async()=>{mocks.record.mockResolvedValue('busy');expect((await POST(request({id:'test1',event:'stock',data:{}}),ctx)).status).toBe(503);});
it('rejects a Stripe link absent from this organization connection',async()=>{
 const lookup=query([]);mocks.db.from.mockReturnValueOnce(query({...connection,provider:'stripe'})).mockReturnValueOnce(lookup);mocks.read.mockResolvedValue(JSON.stringify({token:'test',webhook_secret:secret}));
 const payload={id:'evt_test',type:'checkout.session.completed',data:{object:{id:'cs_test',payment_link:'plink_other',payment_status:'paid',amount_total:100,currency:'usd'}}};
 expect((await POST(request(payload,true),ctx)).status).toBe(409);expect(mocks.record).not.toHaveBeenCalled();
 expect(lookup.eq).toHaveBeenCalledWith('organization_id',org);expect(lookup.eq).toHaveBeenCalledWith('connection_id',id);
});
it('records unpaid checkout as unpaid, not a completed sale',async()=>{
 mocks.db.from.mockReturnValueOnce(query({...connection,provider:'stripe'})).mockReturnValueOnce(query([{id:'known'}]));mocks.read.mockResolvedValue(JSON.stringify({token:'test',webhook_secret:secret}));
 const payload={id:'evt_test',type:'checkout.session.completed',data:{object:{id:'cs_test',payment_link:'plink_known',payment_status:'unpaid',amount_total:100,currency:'usd'}}};
 expect((await POST(request(payload,true),ctx)).status).toBe(200);expect(mocks.record.mock.calls[0]?.[3]).toMatchObject({data:{payment_status:'unpaid'}});
});
