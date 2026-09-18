import { beforeEach,expect,it,vi } from 'vitest';
vi.mock('./provider-http',()=>({providerHttp:vi.fn()}));
import { providerHttp } from './provider-http';
import { communicationActions,testCommunicationCredential } from './communication-actions';
const http=vi.mocked(providerHttp);
beforeEach(()=>vi.resetAllMocks());
async function run(provider:string,input:unknown,credential:unknown,key='isolated-key'){
 const a=communicationActions.find(a=>a.provider===provider)!;return a.output.parse(await a.execute(a.input.parse(input),{credential:JSON.stringify(credential),idempotencyKey:key}));
}
it('does not alter Mailchimp subscription state or expose a profile',async()=>{
 http.mockResolvedValue({status:200,data:{status:'unsubscribed',email_address:'synthetic@example.com'}});
 expect(await run('mailchimp',{email:'synthetic@example.com'},{token:'synthetic',server:'us21',list_id:'abc'})).toEqual({status:'unsubscribed'});
 expect(http.mock.calls[0]?.[1]).toBe('GET');expect(http.mock.calls[0]?.[3]).toBeUndefined();
});
it('handles absent subscribers without creating one',async()=>{
 http.mockResolvedValue({status:404,data:{}});
 expect(await run('mailchimp',{email:'synthetic@example.com'},{token:'synthetic',server:'us21',list_id:'abc'})).toEqual({status:'not_found'});
});
it('isolates Dialogflow sessions and projects only safe result fields',async()=>{
 http.mockResolvedValue({status:200,data:{queryResult:{intent:{displayName:'Product enquiry'},intentDetectionConfidence:0.8,fulfillmentText:'Hello',diagnosticInfo:{secret:'omitted'}}}});
 expect(await run('dialogflow',{text:'Hello',language_code:'en'},{token:'synthetic',project_id:'project-test'})).toEqual({intent:'Product enquiry',confidence:0.8,reply:'Hello'});
 const first=http.mock.calls[0]?.[0];await run('dialogflow',{text:'Hello',language_code:'en'},{token:'synthetic',project_id:'project-test'},'other-org-key');
 expect(http.mock.calls[1]?.[0]).not.toBe(first);
});
it('sends Segment deduplication identity but no arbitrary customer properties',async()=>{
 http.mockResolvedValue({status:200,data:{success:true}});
 expect(await run('segment',{anonymous_id:'synthetic',event:'Viewed product'},{token:'write-key'})).toEqual({accepted:true});
 expect(JSON.parse(http.mock.calls[0]![3]!)).toEqual({anonymousId:'synthetic',event:'Viewed product',messageId:'isolated-key'});
 await expect(run('segment',{anonymous_id:'synthetic',event:'Viewed product',email:'no@example.com'},{token:'write-key'})).rejects.toThrow();
});
it('does not pretend Segment ingestion errors succeeded',async()=>{
 http.mockResolvedValue({status:200,data:{success:false}});
 expect(await testCommunicationCredential('segment',JSON.stringify({token:'test'}))).toBe(false);
});
