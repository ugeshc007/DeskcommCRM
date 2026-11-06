import type { SupabaseClient } from '@supabase/supabase-js';
import { byteaToBuffer,bufToBytea } from '@/lib/crypto/aes_gcm';
import { openCredential,sealCredential } from './vault';
import { consumeCurrentCredential } from './refresh-credential';
import { claimResultSchema } from './postgres-store';
import type { IntegrationExecutionStore } from './execution';

export function createSupabaseIntegrationStore(db: SupabaseClient): IntegrationExecutionStore {
 const connection: IntegrationExecutionStore['connection'] = async (org,id) => {
  const {data,error}=await db.from('integration_connections').select('id,organization_id,provider,revision,active').eq('organization_id',org).eq('id',id).maybeSingle();
  if(error) throw new Error('integration_storage_unavailable');
  return data ? {id:data.id,organizationId:data.organization_id,provider:data.provider,revision:data.revision,active:data.active} : null;
 };
 return {
  connection,
  async readEvent(org,id,eventId) {
   const {data,error}=await db.from('integration_executions').select('output').eq('organization_id',org).eq('connection_id',id).eq('execution_key',`inbound:${id}:${eventId}`).eq('action','received_event').eq('status','succeeded').maybeSingle();
   if(error)throw new Error('integration_storage_unavailable');return data?.output??null;
  },
  async claim(scope,fingerprint,retry,identity) {
   const {data,error}=await db.rpc('fn_integration_claim',{p_org:scope.organizationId,p_key:scope.executionKey,p_connection:identity.connectionId,p_revision:identity.revision,p_action:identity.action,p_fingerprint:fingerprint,p_retry:retry});
   if(error) throw new Error('integration_storage_unavailable');
   return claimResultSchema.parse(data);
  },
  async withCredential(org,id,revision,consume) {
   const current=await connection(org,id);
   if(!current?.active || current.revision!==revision) throw new Error('integration_credential_unavailable');
   const {data,error}=await db.from('integration_credentials').select('ciphertext,iv,tag').eq('organization_id',org).eq('connection_id',id).eq('revision',revision).maybeSingle();
   if(error || !data) throw new Error('integration_credential_unavailable');
   const identity={organizationId:org,connectionId:id,revision};
   const plain=openCredential(identity,{ciphertext:byteaToBuffer(data.ciphertext),iv:byteaToBuffer(data.iv),tag:byteaToBuffer(data.tag)});
   return consumeCurrentCredential(current.provider,plain,async renewed=>{
    const sealed=sealCredential(identity,renewed);
    const result=await db.from('integration_credentials').update({ciphertext:bufToBytea(sealed.ciphertext),iv:bufToBytea(sealed.iv),tag:bufToBytea(sealed.tag)}).eq('organization_id',org).eq('connection_id',id).eq('revision',revision).eq('tag',data.tag).select('connection_id');
    if(result.error)throw new Error('integration_storage_unavailable');return result.data?.length===1;
   },consume);
  },
  async finish(scope,lease,result) {
   const {error}=await db.rpc('fn_integration_finish',{p_org:scope.organizationId,p_key:scope.executionKey,p_lease:lease,p_status:result.status,p_output:result.status==='succeeded'?result.output:null,p_code:result.status==='succeeded'?null:result.code});
   if(error) throw new Error('integration_result_not_recorded');
  },
 };
}
