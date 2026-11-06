import { createHmac } from 'node:crypto';
import { expect,it,vi } from 'vitest';
import { inboundActions,recordInboundEvent,verifyEventSignature } from './inbound';
import type { IntegrationExecutionStore } from './execution';
const secret='synthetic-signing-secret-32-characters';
const now=1800000000000,raw='{"id":"test1"}';
function sign(body=raw,time=now/1000,key=secret){return `t=${time},v1=${createHmac('sha256',key).update(time+'.'+body).digest('hex')}`;}
it('verifies the exact body with a current timestamp',()=>expect(verifyEventSignature(raw,sign(),secret,false,now)).toBe(true));
it.each([sign(raw,now/1000-301),sign(raw,now/1000+301),sign(raw,now/1000,'wrong'),sign() + ',t=1800000000','v1=bad','t=1800000000,v1=00'])('rejects invalid, stale or ambiguous signatures',header=>expect(verifyEventSignature(raw,header,secret,false,now)).toBe(false));
it('rejects modified payload and missing configuration',()=>{
 expect(verifyEventSignature(raw+' ',sign(),secret,false,now)).toBe(false);
 expect(verifyEventSignature(raw,sign(),'',false,now)).toBe(false);
});
it('supports Stripe signing secret rotation headers',()=>expect(verifyEventSignature(raw,sign()+',v1='+'0'.repeat(64),secret,true,now)).toBe(true));
it('records and deduplicates without repeating a finish',async()=>{
 const store={claim:vi.fn().mockResolvedValue({kind:'acquired',lease:'lease'}),finish:vi.fn()} as unknown as IntegrationExecutionStore;
 const c={id:'connection',revision:1},e={id:'event1',event:'stock.updated',data:{stock:5}};
 expect(await recordInboundEvent(store,'org1',c,e)).toBe('recorded');
 expect(store.claim).toHaveBeenCalledWith({organizationId:'org1',executionKey:'inbound:connection:event1'},expect.any(String),'never',{connectionId:'connection',revision:1,action:'received_event'});
 vi.mocked(store.claim).mockResolvedValue({kind:'completed',output:e});
 expect(await recordInboundEvent(store,'org1',c,e)).toBe('duplicate');expect(store.finish).toHaveBeenCalledTimes(1);
});
it('reads only the scoped callback and projects a scalar',async()=>{
 const a=inboundActions[0]!;const readEvent=vi.fn().mockResolvedValue({id:'e1',event:'stock',data:{stock:7}});
 expect(await a.execute({event_id:'e1',field:'stock'},{credential:'',idempotencyKey:'key',readEvent})).toEqual({value:7});
 await expect(a.execute({event_id:'e1',field:'unknown'},{credential:'',idempotencyKey:'key',readEvent})).rejects.toThrow();
});
