import { createHash,randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { createAdminClient } from '@/lib/supabase/admin';
import { ok,fail } from '@/lib/api/wrappers';
import { audit } from '@/lib/audit';
import { env } from '@/lib/env';
import { bufToBytea } from '@/lib/crypto/aes_gcm';
import { sealCredential } from '@/lib/integrations/vault';
import { loadConnection } from '@/lib/integrations/management';
import { googleAuthorizationUrl } from '@/lib/integrations/google-oauth';
import { integrationError,readIntegrationJson } from '../../_shared';
export async function POST(req:Request){
 const denied=await requireSupportWrite();if(denied)return denied;
 const auth=await requireRole('admin');if(!auth.ok)return auth.response;
 if(auth.user.support)return fail('forbidden','Connect from your own organization administrator account.',403);
 try{
  const input=z.strictObject({connection_id:z.uuid(),revision:z.number().int().positive()}).parse(await readIntegrationJson(req));
  const db=createAdminClient(); const c=await loadConnection(db,auth.org.orgId,input.connection_id);
  if(!c||c.provider!=='google_sheets'||c.revision!==input.revision)throw new Error('integration_conflict');
  const state=randomBytes(32).toString('base64url');const browser=randomBytes(32).toString('base64url');const verifier=randomBytes(32).toString('base64url');
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
  const url=googleAuthorizationUrl(state,createHash('sha256').update(verifier).digest('base64url'));
  const sealed=sealCredential({organizationId:auth.org.orgId,connectionId:c.id,revision:c.revision},verifier);
  const {error:cleanup}=await db.from('integration_oauth_states').delete().eq('organization_id',auth.org.orgId).eq('connection_id',c.id);
  if(cleanup)throw new Error('oauth_state_failed');
  const {error}=await db.from('integration_oauth_states').insert({state_hash:hash(state),organization_id:auth.org.orgId,connection_id:c.id,actor_user_id:auth.user.id,revision:c.revision,browser_hash:hash(browser),verifier:{ciphertext:bufToBytea(sealed.ciphertext),iv:bufToBytea(sealed.iv),tag:bufToBytea(sealed.tag)},expires_at:new Date(Date.now()+600000).toISOString()});
  if(error)throw new Error('oauth_state_failed');
  await audit({
    action: 'integration.oauth_started',
    organizationId: auth.org.orgId,
    actorUserId: auth.user.id,
    resourceType: 'integration_connection',
    resourceId: c.id,
  });
  const response=ok({authorization_url:url},{headers:{'Cache-Control':'no-store'}});
  response.cookies.set('integration_oauth_browser',browser,{httpOnly:true,secure:env.NODE_ENV==='production',sameSite:'lax',path:'/api/v1/integration-connections/oauth',maxAge:600});
  return response;
 }catch(error){return integrationError(error);}
}
