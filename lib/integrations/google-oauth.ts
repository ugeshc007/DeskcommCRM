import { z } from 'zod';
import { env } from '@/lib/env';
export const GOOGLE_SCOPES=['openid','https://www.googleapis.com/auth/spreadsheets'];
export function googleOAuthConfigured():boolean { return !!env.INTEGRATIONS_GOOGLE_CLIENT_ID && !!env.INTEGRATIONS_GOOGLE_CLIENT_SECRET; }
export function googleRedirectUri():string { return new URL('/api/v1/integration-connections/oauth/callback',env.NEXT_PUBLIC_APP_URL).toString(); }
export function googleAuthorizationUrl(state:string,challenge:string):string {
 if(!googleOAuthConfigured()) throw new Error('oauth_not_configured');
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
 url.search=new URLSearchParams({client_id:env.INTEGRATIONS_GOOGLE_CLIENT_ID,redirect_uri:googleRedirectUri(),response_type:'code',scope:GOOGLE_SCOPES.join(' '),access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 return url.toString();
}
const tokenSchema=z.object({access_token:z.string().min(1).max(16000),refresh_token:z.string().min(1).max(16000),expires_in:z.number().positive(),scope:z.string(),token_type:z.literal('Bearer')});
async function boundedJson(res:Response):Promise<unknown> {
 if(!res.ok || !res.body) throw new Error('oauth_provider_rejected');
 const reader=res.body.getReader(); let size=0; const parts:Uint8Array[]=[];
 try { while(true){ const item=await reader.read(); if(item.done) break; size+=item.value.length; if(size>65536) throw new Error('oauth_response_invalid'); parts.push(item.value); } }
 finally { await reader.cancel().catch(()=>undefined); }
 return JSON.parse(Buffer.concat(parts).toString('utf8'));
}
export async function exchangeGoogleCode(code:string,verifier:string):Promise<string> {
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.INTEGRATIONS_GOOGLE_CLIENT_ID,client_secret:env.INTEGRATIONS_GOOGLE_CLIENT_SECRET,redirect_uri:googleRedirectUri(),grant_type:'authorization_code',code,code_verifier:verifier})});
 const token=tokenSchema.parse(await boundedJson(response));
 if(GOOGLE_SCOPES.some(scope=>!token.scope.split(' ').includes(scope))) throw new Error('oauth_scope_missing');
 return JSON.stringify({...token,expires_at:new Date(Date.now()+token.expires_in*1000).toISOString()});
}
export async function testGoogleCredential(credential:string):Promise<boolean> {
 try {
  const token=tokenSchema.extend({expires_at:z.iso.datetime()}).parse(JSON.parse(credential));
  if(Date.parse(token.expires_at)<=Date.now()) return false;
  const response=await fetch('https://openidconnect.googleapis.com/v1/userinfo',{headers:{Authorization:'Bearer '+token.access_token},redirect:'error',signal:AbortSignal.timeout(10000)});
  return z.object({sub:z.string().min(1)}).safeParse(await boundedJson(response)).success;
 } catch { return false; }
}

/** Atualização server-only; quem chama persiste pelo CAS do cofre antes de usar. */
export async function refreshGoogleCredential(credential:string):Promise<string> {
 const token=tokenSchema.extend({expires_at:z.iso.datetime()}).parse(JSON.parse(credential));
 if(Date.parse(token.expires_at)>Date.now()+60000)return credential;
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',redirect:'error',signal:AbortSignal.timeout(10000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.INTEGRATIONS_GOOGLE_CLIENT_ID,client_secret:env.INTEGRATIONS_GOOGLE_CLIENT_SECRET,grant_type:'refresh_token',refresh_token:token.refresh_token})});
 const renewed=tokenSchema.omit({refresh_token:true,scope:true}).extend({refresh_token:z.string().min(1).max(16000).optional(),scope:z.string().optional()}).parse(await boundedJson(response));
 const scope=renewed.scope??token.scope;
 if(GOOGLE_SCOPES.some(s=>!scope.split(' ').includes(s)))throw new Error('oauth_scope_missing');
 return JSON.stringify({...renewed,scope,refresh_token:renewed.refresh_token??token.refresh_token,expires_at:new Date(Date.now()+renewed.expires_in*1000).toISOString()});
}
