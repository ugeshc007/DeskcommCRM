import { z } from 'zod';
import { messengerCredentialSchema, MESSENGER_CONNECTION_PROVIDER } from '@/lib/channels/messenger/connection';
import { assertSafeOutboundUrl } from '@/lib/automation/outbound-url';
const token=z.string().min(1).max(16000).regex(/^[^\r\n]+$/);
const endpoint=z.url().max(2048).refine(v=>{try{assertSafeOutboundUrl(v);const u=new URL(v);return u.protocol==='https:'&&!u.search&&!u.hash;}catch{return false;}});
export const apiCredentialSchemas={
 [MESSENGER_CONNECTION_PROVIDER]:messengerCredentialSchema,
 inbound_webhook:z.strictObject({signing_secret:z.string().min(32).max(2048)}),
 mailchimp:z.strictObject({token,server:z.string().regex(/^us[0-9]{1,3}$/),list_id:z.string().regex(/^[a-zA-Z0-9]+$/).max(100)}),
 segment:z.strictObject({token}),
 dialogflow:z.strictObject({token,project_id:z.string().regex(/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/)}),
 custom_api:z.strictObject({url:endpoint,token,method:z.enum(['GET','POST'])}),
 n8n:z.strictObject({url:endpoint,token}),
 zapier:z.strictObject({url:endpoint.refine(v=>new URL(v).hostname==='hooks.zapier.com')}),
 calendly:z.strictObject({token,event_type_id:z.string().regex(/^[A-Za-z0-9-]+$/)}),
 salesforce:z.strictObject({token,instance_url:z.url().refine(v=>{const u=new URL(v);return u.protocol==='https:'&&/^[a-z0-9-]+\.my\.salesforce\.com$/.test(u.hostname)&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password&&!u.port;})}),
 airtable:z.strictObject({token,base_id:z.string().regex(/^app[A-Za-z0-9]+$/),table_id:z.string().regex(/^tbl[A-Za-z0-9]+$/)}),
 hubspot:z.strictObject({token}),
 stripe:z.strictObject({token,webhook_secret:z.string().min(16).max(2048).optional()}),
 slack:z.strictObject({token,channel_id:z.string().regex(/^[CG][A-Z0-9]+$/)}),
 sendgrid:z.strictObject({token,from_email:z.email(),staff_email:z.email()}),
} as const;
export type ApiProvider=keyof typeof apiCredentialSchemas;
export function parseApiCredential(provider:string,value:unknown):unknown {
 if(!Object.hasOwn(apiCredentialSchemas,provider))throw new Error('invalid_request');
 return apiCredentialSchemas[provider as ApiProvider].parse(value);
}
