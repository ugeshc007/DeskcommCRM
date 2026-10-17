import { randomUUID } from 'node:crypto';
import { MESSENGER_CONNECTION_PROVIDER } from '@/lib/channels/messenger/public-config';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { createAdminClient } from '@/lib/supabase/admin';
import { ok } from '@/lib/api/wrappers';
import { audit } from '@/lib/audit';
import { INTEGRATION_CATALOG,CONNECTION_COLUMNS,HISTORY_COLUMNS } from '@/lib/integrations/catalog';
import { manageConnection } from '@/lib/integrations/management';
import { webhookCredentialSchema } from '@/lib/integrations/providers';
import { googleOAuthConfigured } from '@/lib/integrations/google-oauth';
import { parseApiCredential } from '@/lib/integrations/provider-credentials';
import { readIntegrationJson,integrationError } from './_shared';
export const dynamic='force-dynamic';
const createSchema=z.discriminatedUnion('provider',[
 z.strictObject({provider:z.literal('webhook'),label:z.string().trim().min(1).max(120),credential:webhookCredentialSchema}),
 z.strictObject({provider:z.literal('google_sheets'),label:z.string().trim().min(1).max(120)}),
 z.strictObject({provider:z.enum(['airtable','hubspot','stripe','slack','sendgrid','custom_api','n8n','zapier','salesforce','calendly','mailchimp','segment','dialogflow','inbound_webhook',MESSENGER_CONNECTION_PROVIDER]),label:z.string().trim().min(1).max(120),credential:z.unknown()}),
]);
export async function GET() {
 const auth=await requireRole('manager'); if(!auth.ok)return auth.response;
 try {
  const db=createAdminClient();
  const [connections,runs]=await Promise.all([
   db.from('integration_connections').select(CONNECTION_COLUMNS).eq('organization_id',auth.org.orgId).order('created_at',{ascending:false}).limit(100),
   db.from('integration_executions').select(HISTORY_COLUMNS).eq('organization_id',auth.org.orgId).order('created_at',{ascending:false}).limit(50),
  ]);
  if(connections.error||runs.error)throw new Error('integration_storage_unavailable');
  return ok({catalog:INTEGRATION_CATALOG,connections:connections.data??[],runs:runs.data??[],can_manage:auth.org.role==='admin'&&!auth.user.support,google_oauth_configured:googleOAuthConfigured()},{headers:{'Cache-Control':'no-store'}});
 } catch(error){return integrationError(error);}
}
export async function POST(req:Request) {
 const denied=await requireSupportWrite();if(denied)return denied;
 const auth=await requireRole('admin');if(!auth.ok)return auth.response;
 try {
  const input=createSchema.parse(await readIntegrationJson(req));
  const id=z.uuid().parse(req.headers.get('Idempotency-Key')??randomUUID());
  const credential=input.provider==='google_sheets'?undefined:JSON.stringify(input.provider==='webhook'?input.credential:parseApiCredential(input.provider,input.credential));
  const c=await manageConnection(createAdminClient(),auth.user.id,auth.org.orgId,{id,revision:0,provider:input.provider,label:input.label,auth_kind:input.provider==='google_sheets'?'oauth':'api_key'},'save',credential);
  await audit({action:'integration.connection_saved',organizationId:auth.org.orgId,actorUserId:auth.user.id,resourceType:'integration_connection',resourceId:id,metadata:{revision:c.revision,provider:c.provider}});
  return ok(c,{status:201,headers:{'Cache-Control':'no-store'}});
 }catch(error){return integrationError(error);}
}
