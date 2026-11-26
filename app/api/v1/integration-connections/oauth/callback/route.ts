import { createHash } from 'node:crypto';
import { NextResponse,type NextRequest } from 'next/server';
import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { audit } from '@/lib/audit';
import { authRateLimited,AUTH_LIMITS } from '@/lib/auth/rate-limit';
import { byteaToBuffer } from '@/lib/crypto/aes_gcm';
import { openCredential } from '@/lib/integrations/vault';
import { loadConnection,manageConnection } from '@/lib/integrations/management';
import { exchangeGoogleCode,testGoogleCredential } from '@/lib/integrations/google-oauth';
const stateSchema=z.object({organization_id:z.uuid(),connection_id:z.uuid(),actor_user_id:z.uuid(),revision:z.number().int().positive(),verifier:z.object({ciphertext:z.string(),iv:z.string(),tag:z.string()})});
/** Público apenas na borda: estado opaco aleatório + cookie HttpOnly + nonce
 * consumido atomicamente + papel/revisão atuais no banco. Nenhuma org do query.
 */
export async function GET(req:NextRequest){
 let outcome='failed';
 try{
  if(await authRateLimited('integration_oauth',null,AUTH_LIMITS.invite_accept))throw new Error('oauth_rate_limited');
  const state=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.nextUrl.searchParams.get('state'));
  const browser=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(req.cookies.get('integration_oauth_browser')?.value);
  const hash=(s:string)=>createHash('sha256').update(s).digest('hex');const db=createAdminClient();
  const {data,error}=await db.rpc('fn_integration_oauth_consume',{p_state:hash(state),p_browser:hash(browser)});
  if(error)throw new Error('oauth_invalid_state');
  const s=stateSchema.parse(data);
  if(req.nextUrl.searchParams.has('error'))throw new Error('oauth_denied');
  const code=z.string().min(1).max(8192).parse(req.nextUrl.searchParams.get('code'));
  const c=await loadConnection(db,s.organization_id,s.connection_id);
  if(!c||c.provider!=='google_sheets'||c.revision!==s.revision)throw new Error('oauth_stale');
  const verifier=openCredential({organizationId:s.organization_id,connectionId:c.id,revision:c.revision},{ciphertext:byteaToBuffer(s.verifier.ciphertext),iv:byteaToBuffer(s.verifier.iv),tag:byteaToBuffer(s.verifier.tag)});
  const credential=await exchangeGoogleCode(code,verifier);
  if(!await testGoogleCredential(credential))throw new Error('oauth_validation_failed');
  await manageConnection(db,s.actor_user_id,s.organization_id,c,'save',credential,true);
  await audit({action:'integration.connection_saved',organizationId:s.organization_id,actorUserId:s.actor_user_id,resourceType:'integration_connection',resourceId:c.id,metadata:{provider:c.provider}});
  outcome='connected';
 }catch{/* Never return provider descriptions, authorization codes or tokens. */}
 const response=NextResponse.redirect(new URL('/app/integrations?oauth='+outcome,env.NEXT_PUBLIC_APP_URL),303);
 response.headers.set('Cache-Control','no-store');response.headers.set('Referrer-Policy','no-referrer');
 response.cookies.set('integration_oauth_browser','',{httpOnly:true,secure:env.NODE_ENV==='production',sameSite:'lax',path:'/api/v1/integration-connections/oauth',maxAge:0});
 return response;
}
