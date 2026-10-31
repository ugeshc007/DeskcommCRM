import { z } from 'zod';
import { MESSENGER_CONNECTION_PROVIDER, testMessengerCredential } from '@/lib/channels/messenger/connection';
import { ConnectorRejected,type ConnectorAction } from './execution';
import { providerHttp } from './provider-http';
import { apiCredentialSchemas } from './provider-credentials';
import { refreshGoogleCredential } from './google-oauth';
import { postOutboundWebhook } from '@/lib/automation/outbound-request';
import { testCommunicationCredential } from './communication-actions';

const text=z.string().min(1).max(2000);
const scalar=z.union([z.string().max(2000),z.number().finite(),z.boolean()]);
const valueOutput=z.strictObject({value:scalar});
const idOutput=z.strictObject({id:z.string().min(1).max(200)});
const cell=z.strictObject({spreadsheet_id:z.string().regex(/^[A-Za-z0-9_-]+$/).max(200),range:text});
const recordInput=z.strictObject({record_id:z.string().regex(/^rec[A-Za-z0-9]+$/),field:text});
const row=z.string().max(16000).transform((v,ctx)=>{try{return z.array(scalar).min(1).max(30).parse(JSON.parse(v));}catch{ctx.addIssue({code:'custom',message:'Enter a JSON array of up to 30 cell values.'});return z.NEVER;}});
const fields=z.string().max(16000).transform((v,ctx)=>{try{return z.record(z.string().min(1).max(120),scalar).refine(o=>Object.keys(o).length>0&&Object.keys(o).length<=30).parse(JSON.parse(v));}catch{ctx.addIssue({code:'custom',message:'Enter a JSON object of up to 30 fields.'});return z.NEVER;}});
async function googleToken(secret:string){return z.object({access_token:z.string().min(1).max(16000)}).parse(JSON.parse(await refreshGoogleCredential(secret))).access_token;}
const bearer=(token:string)=>({Authorization:'Bearer '+token,'Content-Type':'application/json'});
async function checked(url:string,method:'GET'|'POST',token:string,body?:unknown){
 const r=await providerHttp(url,method,bearer(token),body===undefined?undefined:JSON.stringify(body));
 // Erros HTTP de escrita são ambíguos: o ledger não repete o efeito.
 if(r.status<200||r.status>=300){if(method==='GET')throw new ConnectorRejected();throw new Error('integration_delivery_uncertain');}return r.data;
}
export const dataActions:readonly ConnectorAction[]=[
 {provider:'google_sheets',action:'read_cell',retry:'read_only',input:cell,output:valueOutput,async execute(raw,c){
  const i=cell.parse(raw),token=await googleToken(c.credential);
  const r=z.object({values:z.array(z.array(scalar)).optional()}).parse(await checked(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(i.spreadsheet_id)}/values/${encodeURIComponent(i.range)}?valueRenderOption=UNFORMATTED_VALUE`,'GET',token));
  const first=r.values?.[0];if(r.values?.length!==1||first?.length!==1)throw new ConnectorRejected();return {value:first[0]};
 }},
 {provider:'google_sheets',action:'append_row',retry:'never',input:cell.extend({values_json:row}),output:z.strictObject({updated_rows:z.number().int().nonnegative()}),async execute(raw,c){
  // O executor já normalizou o JSON; validar o contrato normalizado novamente.
  const i=cell.extend({values_json:z.array(scalar).min(1).max(30)}).parse(raw),token=await googleToken(c.credential);
  const r=z.object({updates:z.object({updatedRows:z.number().int().nonnegative()})}).parse(await checked(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(i.spreadsheet_id)}/values/${encodeURIComponent(i.range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,'POST',token,{values:[i.values_json]}));
  return {updated_rows:r.updates.updatedRows};
 }},
 {provider:'airtable',action:'read_field',retry:'read_only',input:recordInput,output:valueOutput,async execute(raw,c){
  const i=recordInput.parse(raw),s=apiCredentialSchemas.airtable.parse(JSON.parse(c.credential));
  const r=z.object({fields:z.record(z.string(),z.unknown())}).parse(await checked(`https://api.airtable.com/v0/${s.base_id}/${s.table_id}/${i.record_id}`,'GET',s.token));
  if(!Object.hasOwn(r.fields,i.field))throw new ConnectorRejected();return {value:scalar.parse(r.fields[i.field])};
 }},
 {provider:'airtable',action:'create_record',retry:'never',input:z.strictObject({fields_json:fields}),output:idOutput,async execute(raw,c){
  const i=z.object({fields_json:z.record(z.string(),scalar)}).parse(raw),s=apiCredentialSchemas.airtable.parse(JSON.parse(c.credential));
  const r=z.object({records:z.array(z.object({id:z.string().min(1).max(200)})).length(1)}).parse(await checked(`https://api.airtable.com/v0/${s.base_id}/${s.table_id}`,'POST',s.token,{records:[{fields:i.fields_json}],typecast:false}));return r.records[0];
 }},
];

/** Testes HTTP personalizados podem disparar workflows; a UI exige confirmação. */
export async function testApiCredential(provider:string,credential:string):Promise<boolean>{
 try{
  if(provider===MESSENGER_CONNECTION_PROVIDER)return await testMessengerCredential(credential);
  if(provider==='inbound_webhook'){apiCredentialSchemas.inbound_webhook.parse(JSON.parse(credential));return true;}
  if(provider==='mailchimp'||provider==='dialogflow'||provider==='segment')return await testCommunicationCredential(provider,credential);
  if(provider==='salesforce'){const c=apiCredentialSchemas.salesforce.parse(JSON.parse(credential));await checked(new URL('/services/data/v66.0/sobjects/Contact/describe',c.instance_url).toString(),'GET',c.token);return true;}
  if(provider==='calendly'){const c=apiCredentialSchemas.calendly.parse(JSON.parse(credential));await checked('https://api.calendly.com/event_types/'+c.event_type_id,'GET',c.token);return true;}
  if(provider==='custom_api'){const c=apiCredentialSchemas.custom_api.parse(JSON.parse(credential));await checked(c.url,c.method,c.token,c.method==='POST'?{event:'connection_test',synthetic:true}:undefined);return true;}
  if(provider==='n8n'||provider==='zapier'){const c=apiCredentialSchemas[provider].parse(JSON.parse(credential));const headers:Record<string,string>={'Content-Type':'application/json'};if('token' in c && typeof c.token==='string')headers['X-Webhook-Token']=c.token;const status=await postOutboundWebhook(c.url,JSON.stringify({event:'connection_test',synthetic:true}),headers);return status>=200&&status<300;}
  if(provider==='airtable'){const c=apiCredentialSchemas.airtable.parse(JSON.parse(credential));await checked(`https://api.airtable.com/v0/${c.base_id}/${c.table_id}?maxRecords=1`,'GET',c.token);return true;}
  if(provider==='hubspot'){const c=apiCredentialSchemas.hubspot.parse(JSON.parse(credential));await checked('https://api.hubapi.com/crm/v3/objects/contacts?limit=1','GET',c.token);return true;}
  if(provider==='stripe'){const c=apiCredentialSchemas.stripe.parse(JSON.parse(credential));await checked('https://api.stripe.com/v1/payment_links?limit=1','GET',c.token);return true;}
  if(provider==='slack'){const c=apiCredentialSchemas.slack.parse(JSON.parse(credential));return z.object({ok:z.literal(true)}).safeParse(await checked('https://slack.com/api/auth.test','GET',c.token)).success;}
  if(provider==='sendgrid'){const c=apiCredentialSchemas.sendgrid.parse(JSON.parse(credential));await checked('https://api.sendgrid.com/v3/scopes','GET',c.token);return true;}
  return false;
 }catch{return false;}
}
