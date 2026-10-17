import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { createAdminClient } from '@/lib/supabase/admin';
import { ok,fail } from '@/lib/api/wrappers';
import { audit } from '@/lib/audit';
import { manageConnection,loadConnection,readConnectionCredential } from '@/lib/integrations/management';
import { webhookCredentialSchema,integrationActions } from '@/lib/integrations/providers';
import { testGoogleCredential,refreshGoogleCredential } from '@/lib/integrations/google-oauth';
import { readIntegrationJson,integrationError } from '../_shared';
import { parseApiCredential } from '@/lib/integrations/provider-credentials';
import { testApiCredential } from '@/lib/integrations/data-actions';
const schema=z.discriminatedUnion('operation',[
 z.strictObject({operation:z.literal('rotate'),revision:z.number().int().positive(),label:z.string().trim().min(1).max(120),credential:z.unknown()}),
 z.strictObject({operation:z.enum(['test','disconnect']),revision:z.number().int().positive()}),
]);
export async function POST(req:Request,ctx:{params:Promise<{id:string}>}) {
 const denied=await requireSupportWrite();if(denied)return denied;
 const auth=await requireRole('admin');if(!auth.ok)return auth.response;
 try{
  const id=z.uuid().parse((await ctx.params).id);const input=schema.parse(await readIntegrationJson(req));const db=createAdminClient();
  const c=await loadConnection(db,auth.org.orgId,id);if(!c)return fail('not_found','Connection not found.',404);
  if(c.revision!==input.revision)throw new Error('integration_conflict');
  let verified=false;let credential:string|undefined;
  if(input.operation==='rotate'){
   if(c.provider==='google_sheets')return fail('validation_failed','Use OAuth reconnect for this account.',422);
   credential=JSON.stringify(c.provider==='webhook'?webhookCredentialSchema.parse(input.credential):parseApiCredential(c.provider,input.credential));c.label=input.label;
  }
  if(input.operation==='test'){
   const secret=await readConnectionCredential(db,auth.org.orgId,c);
   if(c.provider==='google_sheets'){
    try { const renewed=await refreshGoogleCredential(secret);verified=await testGoogleCredential(renewed);if(verified&&renewed!==secret)credential=renewed; } catch { verified=false; }
   }
   else if(c.provider==='webhook'){
    try{await integrationActions[0]!.execute({event:'connection_test',value:'Synthetic connection test'},{credential:secret,idempotencyKey:randomUUID()});verified=true;}catch{verified=false;}
   }else verified=await testApiCredential(c.provider,secret);
  }
  const saved=await manageConnection(db,auth.user.id,auth.org.orgId,c,input.operation==='rotate'||credential?'save':input.operation,credential,verified);
  const action=input.operation==='rotate'?'integration.connection_saved':input.operation==='test'?'integration.connection_tested':'integration.connection_disconnected';
  await audit({action,organizationId:auth.org.orgId,actorUserId:auth.user.id,resourceType:'integration_connection',resourceId:id,metadata:{revision:saved.revision,verified:saved.active}});
  return ok(saved,{headers:{'Cache-Control':'no-store'}});
 }catch(error){return integrationError(error);}
}
