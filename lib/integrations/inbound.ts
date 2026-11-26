import { createHmac, timingSafeEqual, createHash } from 'node:crypto';
import { z } from 'zod';
import type { ConnectorAction, IntegrationExecutionStore } from './execution';
import { ConnectorRejected } from './execution';
export const eventIdSchema=z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const scalar=z.union([z.string().max(2000),z.number().finite(),z.boolean()]);
export const inboundEventSchema=z.strictObject({id:eventIdSchema,event:z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/),data:z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),scalar).refine(v=>Object.keys(v).length<=30)});
/** Signature horodatée: vérification avant parsing; comparaison constante. */
export function verifyEventSignature(raw:string,header:string|null,secret:string,stripe=false,now=Date.now()):boolean{
 if(!header||header.length>4096||secret.length<16)return false;
 const parts=header.split(',');const times=parts.filter(p=>p.startsWith('t='));
 if(times.length!==1)return false;const time=times[0]!.slice(2);
 if(!/^\d{10}$/.test(time)||Math.abs(now/1000-Number(time))>300)return false;
 const expected=createHmac('sha256',secret).update(time+'.'+raw).digest();
 const signatures=parts.filter(p=>p.startsWith('v1=')).map(p=>p.slice(3));
 if(!stripe&&signatures.length!==1)return false;
 return signatures.some(value=>/^[a-f0-9]{64}$/.test(value)&&timingSafeEqual(expected,Buffer.from(value,'hex')));
}
export async function recordInboundEvent(store:IntegrationExecutionStore,org:string,connection:{id:string;revision:number},event:z.infer<typeof inboundEventSchema>):Promise<'recorded'|'duplicate'|'conflict'|'busy'>{
 const scope={organizationId:org,executionKey:`inbound:${connection.id}:${event.id}`};
 const fingerprint=createHash('sha256').update(JSON.stringify(event)).digest('hex');
 const claim=await store.claim(scope,fingerprint,'never',{connectionId:connection.id,revision:connection.revision,action:'received_event'});
 if(claim.kind==='completed')return 'duplicate';
 if(claim.kind==='conflict')return 'conflict';
 if(claim.kind!=='acquired')return 'busy';
 await store.finish(scope,claim.lease,{status:'succeeded',output:event});return 'recorded';
}
const readInput=z.strictObject({event_id:eventIdSchema,field:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)});
export const inboundActions:readonly ConnectorAction[]=['inbound_webhook','stripe'].map(provider=>({provider,action:'read_received_event',retry:'read_only',input:readInput,output:z.strictObject({value:scalar}),async execute(raw,context){
 const input=readInput.parse(raw);if(!context.readEvent)throw new ConnectorRejected();
 const event=inboundEventSchema.safeParse(await context.readEvent(input.event_id));
 if(!event.success||!Object.hasOwn(event.data.data,input.field))throw new ConnectorRejected();return {value:event.data.data[input.field]};
}}));
