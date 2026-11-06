import type { SupabaseClient } from '@supabase/supabase-js';
import { byteaToBuffer, bufToBytea } from '@/lib/crypto/aes_gcm';
import { openCredential, sealCredential } from './vault';
import { CONNECTION_COLUMNS, type PublicConnection } from './catalog';

export async function loadConnection(db:SupabaseClient,org:string,id:string):Promise<PublicConnection|null> {
 const {data,error}=await db.from('integration_connections').select(CONNECTION_COLUMNS).eq('organization_id',org).eq('id',id).maybeSingle();
 if(error) throw new Error('integration_storage_unavailable');
 return data as PublicConnection|null;
}
export async function readConnectionCredential(db:SupabaseClient,org:string,c:PublicConnection):Promise<string> {
 const {data,error}=await db.from('integration_credentials').select('ciphertext,iv,tag').eq('organization_id',org).eq('connection_id',c.id).eq('revision',c.revision).maybeSingle();
 if(error||!data) throw new Error('integration_credential_unavailable');
 return openCredential({organizationId:org,connectionId:c.id,revision:c.revision},{ciphertext:byteaToBuffer(data.ciphertext),iv:byteaToBuffer(data.iv),tag:byteaToBuffer(data.tag)});
}
export async function manageConnection(db:SupabaseClient,actor:string,org:string,c:{id:string;revision:number;provider:string;label:string;auth_kind:string},op:'save'|'test'|'disconnect',credential?:string,verified=false):Promise<PublicConnection> {
 const sealed=credential ? sealCredential({organizationId:org,connectionId:c.id,revision:c.revision+1},credential) : null;
 const {data,error}=await db.rpc('fn_integration_manage',{p_org:org,p_actor:actor,p_id:c.id,p_revision:c.revision,p_provider:c.provider,p_label:c.label,p_auth_kind:c.auth_kind,p_op:op,p_ciphertext:sealed?bufToBytea(sealed.ciphertext):null,p_iv:sealed?bufToBytea(sealed.iv):null,p_tag:sealed?bufToBytea(sealed.tag):null,p_verified:verified});
 if(error) throw new Error(error.code==='40001'?'integration_conflict':error.code==='42501'?'integration_forbidden':'integration_save_failed');
 // Explicit projection: no future database columns automatically reach clients.
 return {id:data.id,provider:data.provider,label:data.label,revision:data.revision,active:data.active,auth_kind:data.auth_kind,validated_at:data.validated_at,failure_code:data.failure_code};
}
