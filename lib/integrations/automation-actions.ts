import { z } from 'zod';
import { providerHttp } from './provider-http';
import { postOutboundWebhook } from '@/lib/automation/outbound-request';
import { apiCredentialSchemas } from './provider-credentials';
import { ConnectorRejected,type ConnectorAction } from './execution';
const scalar=z.union([z.string().max(2000),z.number().finite(),z.boolean()]);
const payload=z.string().max(16000).transform((v,ctx)=>{try{return z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),scalar).parse(JSON.parse(v));}catch{ctx.addIssue({code:'custom',message:'Enter a JSON object with simple field values.'});return z.NEVER;}});
export const automationActions:readonly ConnectorAction[]=[
 ...(['n8n','zapier'] as const).map(provider=>({provider,action:'trigger_workflow',retry:'never' as const,input:z.strictObject({payload_json:payload}),output:z.strictObject({accepted:z.literal(true)}),async execute(raw:unknown,c:{credential:string;idempotencyKey:string}){
  const input=z.object({payload_json:z.record(z.string(),scalar)}).parse(raw);
  const credentials=apiCredentialSchemas[provider].parse(JSON.parse(c.credential));
  const headers:Record<string,string>={'Content-Type':'application/json','X-Idempotency-Key':c.idempotencyKey};
  if('token' in credentials && typeof credentials.token==='string')headers['X-Webhook-Token']=credentials.token;
  const status=await postOutboundWebhook(credentials.url,JSON.stringify({id:c.idempotencyKey,data:input.payload_json}),headers);
  if(status<200||status>=300)throw new Error('integration_delivery_uncertain');return {accepted:true};
 }})),
 {provider:'custom_api',action:'request_value',retry:'never',input:z.strictObject({payload_json:payload,response_field:z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)}),output:z.strictObject({value:scalar}),async execute(raw,c){
  const i=z.object({payload_json:z.record(z.string(),scalar),response_field:z.string()}).parse(raw);
  const s=apiCredentialSchemas.custom_api.parse(JSON.parse(c.credential));
  const r=await providerHttp(s.url,s.method,{Authorization:'Bearer '+s.token,'Content-Type':'application/json','X-Idempotency-Key':c.idempotencyKey},s.method==='POST'?JSON.stringify(i.payload_json):undefined);
  if(r.status<200||r.status>=300){if(s.method==='GET')throw new ConnectorRejected();throw new Error('integration_delivery_uncertain');}
  if(!r.data||typeof r.data!=='object'||!Object.hasOwn(r.data,i.response_field))throw new Error('integration_response_invalid');
  const value=scalar.parse((r.data as Record<string,unknown>)[i.response_field]);
  // Não deixa um endpoint ecoar o próprio bearer em uma variável de conversa.
  if(typeof value==='string'&&value.includes(s.token))throw new Error('integration_response_invalid');return {value};
 }},
];
