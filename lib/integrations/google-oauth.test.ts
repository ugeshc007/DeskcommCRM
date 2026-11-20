import { afterEach,describe,expect,it,vi } from 'vitest';
vi.mock('@/lib/env',()=>({env:{NEXT_PUBLIC_APP_URL:'https://crm.example.test',INTEGRATIONS_GOOGLE_CLIENT_ID:'synthetic-client',INTEGRATIONS_GOOGLE_CLIENT_SECRET:'synthetic-secret'}}));
import { exchangeGoogleCode,googleAuthorizationUrl,googleRedirectUri,testGoogleCredential,refreshGoogleCredential,GOOGLE_SCOPES } from './google-oauth';
afterEach(()=>vi.unstubAllGlobals());
describe('Google OAuth boundary',()=>{
 it('refreshes expired access without dropping the stored refresh token',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({access_token:'renewed',expires_in:3600,token_type:'Bearer'})));vi.stubGlobal('fetch',fetcher);
  const credential=JSON.stringify({access_token:'old',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'Bearer',scope:GOOGLE_SCOPES.join(' '),expires_at:'2000-01-01T00:00:00.000Z'});
  expect(JSON.parse(await refreshGoogleCredential(credential))).toMatchObject({access_token:'renewed',refresh_token:'synthetic-refresh'});
  expect(fetcher.mock.calls[0]?.[1].body.get('grant_type')).toBe('refresh_token');
 });
 it('binds authorization to the fixed callback, state and PKCE without a client secret',()=>{
  const url=new URL(googleAuthorizationUrl('state','challenge'));
  expect(url.origin).toBe('https://accounts.google.com');
  expect(url.searchParams.get('redirect_uri')).toBe(googleRedirectUri());
  expect(url.searchParams.get('state')).toBe('state');expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.toString()).not.toContain('synthetic-secret');
 });
 it('exchanges credentials only through a server POST and rejects missing scopes',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'Bearer',scope:'openid'})));
  vi.stubGlobal('fetch',fetcher);
  await expect(exchangeGoogleCode('synthetic-code','verifier')).rejects.toThrow('oauth_scope_missing');
  expect(fetcher.mock.calls[0]?.[0]).toBe('https://oauth2.googleapis.com/token');
  expect(fetcher.mock.calls[0]?.[1]).toMatchObject({method:'POST',redirect:'error'});
 });
 it('stores expiry server-side and refuses expired credentials without a remote request',async()=>{
  const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({access_token:'synthetic-access',refresh_token:'synthetic-refresh',expires_in:3600,token_type:'Bearer',scope:GOOGLE_SCOPES.join(' ')})));
  vi.stubGlobal('fetch',fetcher);
  const stored=JSON.parse(await exchangeGoogleCode('code','verifier'));
  expect(Date.parse(stored.expires_at)).toBeGreaterThan(Date.now());
  fetcher.mockClear();stored.expires_at='2000-01-01T00:00:00.000Z';
  expect(await testGoogleCredential(JSON.stringify(stored))).toBe(false);expect(fetcher).not.toHaveBeenCalled();
 });
});
