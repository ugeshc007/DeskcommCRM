import { beforeEach, expect, it, vi } from 'vitest';
vi.mock('./provider-http',()=>({providerHttp:vi.fn()}));
vi.mock('./google-oauth',()=>({refreshGoogleCredential:vi.fn(async(s:string)=>s)}));
vi.mock('@/lib/automation/outbound-request',()=>({postOutboundWebhook:vi.fn()}));
import { providerHttp } from './provider-http';
import { postOutboundWebhook } from '@/lib/automation/outbound-request';
import { integrationActions } from './providers';
import { INTEGRATION_CATALOG } from './catalog';
import { parseApiCredential } from './provider-credentials';
const http=vi.mocked(providerHttp);
async function run(provider:string,action:string,input:unknown,credential:unknown){
 const a=integrationActions.find(a=>a.provider===provider&&a.action===action)!;
 return a.output.parse(await a.execute(a.input.parse(input),{credential:JSON.stringify(credential),idempotencyKey:'synthetic-stable-key'}));
}
beforeEach(()=>vi.resetAllMocks());
it('every advertised action has an executable adapter',()=>{
 for(const p of INTEGRATION_CATALOG)for(const a of p.actions)expect(integrationActions.some(x=>x.provider===p.id&&x.action===a.id)).toBe(true);
});
it('reads exactly one Google cell',async()=>{
 http.mockResolvedValue({status:200,data:{values:[[42]]}});
 expect(await run('google_sheets','read_cell',{spreadsheet_id:'sheet1',range:'A1'},{access_token:'test'})).toEqual({value:42});
 http.mockResolvedValue({status:200,data:{values:[]}});
 await expect(run('google_sheets','read_cell',{spreadsheet_id:'sheet1',range:'A1'},{access_token:'test'})).rejects.toThrow();
});
it('appends RAW values without evaluating formulas',async()=>{
 http.mockResolvedValue({status:200,data:{updates:{updatedRows:1}}});
 expect(await run('google_sheets','append_row',{spreadsheet_id:'sheet1',range:'A1',values_json:'["=1+1",2]'},{access_token:'test'})).toEqual({updated_rows:1});
 expect(http.mock.calls[0]?.[0]).toContain('valueInputOption=RAW');
 expect(JSON.parse(http.mock.calls[0]![3]!)).toEqual({values:[['=1+1',2]]});
});
it('projects Airtable IDs from full provider responses',async()=>{
 http.mockResolvedValue({status:200,data:{records:[{id:'rec123',fields:{secret:'not returned'},createdTime:'today'}]}});
 expect(await run('airtable','create_record',{fields_json:'{"Name":"Synthetic"}'},{token:'test',base_id:'app123',table_id:'tbl123'})).toEqual({id:'rec123'});
});
it.each(['hubspot','salesforce'])('projects %s contact responses',async provider=>{
 http.mockResolvedValue({status:201,data:{id:'contact1',success:true,properties:{private:'not returned'}}});
 expect(await run(provider,'create_contact',{email:'synthetic@example.com',first_name:'Test',last_name:'User'},{token:'test',...(provider==='salesforce'?{instance_url:'https://example.my.salesforce.com'}:{})})).toEqual({id:'contact1'});
});
it('uses a stable Stripe idempotency key and existing price',async()=>{
 http.mockResolvedValue({status:200,data:{id:'plink_1',url:'https://buy.stripe.com/test',extra:'omitted'}});
 expect(await run('stripe','create_payment_link',{price_id:'price_1',quantity:2},{token:'test'})).toEqual({id:'plink_1',url:'https://buy.stripe.com/test'});
 expect(http.mock.calls[0]?.[2]['Idempotency-Key']).toBe('synthetic-stable-key');
 expect(new URLSearchParams(http.mock.calls[0]?.[3]).get('line_items[0][quantity]')).toBe('2');
});
it('pins staff notification destination to the connection',async()=>{
 http.mockResolvedValue({status:200,data:{ok:true,ts:'1.2'}});
 await run('slack','notify_staff',{text:'Synthetic'},{token:'test',channel_id:'C123'});
 expect(JSON.parse(http.mock.calls[0]![3]!)).toMatchObject({channel:'C123',mrkdwn:false,parse:'none'});
 await expect(run('slack','notify_staff',{text:'Synthetic',channel:'C999'},{token:'test',channel_id:'C123'})).rejects.toThrow();
});
it('does not return provider errors or treat failed writes as success',async()=>{
 http.mockResolvedValue({status:500,data:{token:'remote-secret'}});
 await expect(run('hubspot','create_deal',{name:'Test',pipeline_id:'p1',stage_id:'s1'},{token:'test'})).rejects.toThrow('integration_delivery_uncertain');
});
it('sends a workflow deduplication key',async()=>{
 vi.mocked(postOutboundWebhook).mockResolvedValue(200);
 expect(await run('n8n','trigger_workflow',{payload_json:'{"name":"Synthetic"}'},{url:'https://example.com/hook',token:'test'})).toEqual({accepted:true});
 expect(JSON.parse(vi.mocked(postOutboundWebhook).mock.calls[0]![1])).toEqual({id:'synthetic-stable-key',data:{name:'Synthetic'}});
});
it('rejects custom API credential reflection',async()=>{
 http.mockResolvedValue({status:200,data:{value:'echo test-token'}});
 await expect(run('custom_api','request_value',{payload_json:'{}',response_field:'value'},{url:'https://example.com/api',method:'GET',token:'test-token'})).rejects.toThrow('integration_response_invalid');
});
it.each(['http://example.com','https://127.0.0.1','https://example.com/?token=x'])('rejects unsafe custom endpoint %s',url=>{
 expect(()=>parseApiCredential('custom_api',{url,token:'test',method:'GET'})).toThrow();
});
