import { z } from 'zod';
import { createAdminClient } from '@/lib/supabase/admin';
import { fail,ok } from '@/lib/api/wrappers';
import { checkRateLimit } from '@/lib/ai/dispatcher/rate-limit';
import { readConnectionCredential } from '@/lib/integrations/management';
import type { PublicConnection } from '@/lib/integrations/catalog';
import { apiCredentialSchemas } from '@/lib/integrations/provider-credentials';
import { createSupabaseIntegrationStore } from '@/lib/integrations/supabase-store';
import { inboundEventSchema,recordInboundEvent,verifyEventSignature } from '@/lib/integrations/inbound';
import { audit } from '@/lib/audit';
import { applyCheckoutPaymentEvent, checkoutEventSchema } from '@/lib/ecommerce/payment-events';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
export const runtime='nodejs';

async function boundedBody(req:Request):Promise<string>{
 if(!req.body)throw new Error('invalid_body');const reader=req.body.getReader();const chunks:Uint8Array[]=[];let bytes=0;
 try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>65536)throw new Error('invalid_body');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>undefined);}
 return Buffer.concat(chunks).toString('utf8');
}
const stripeEvent=z.object({id:z.string().regex(/^evt_[A-Za-z0-9]+$/).max(100),type:z.enum(['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed']),data:z.object({object:z.object({id:z.string().regex(/^cs_[A-Za-z0-9_]+$/),payment_link:z.string().regex(/^plink_[A-Za-z0-9]+$/),payment_status:z.enum(['paid','unpaid','no_payment_required']),amount_total:z.number().int().nonnegative(),currency:z.string().regex(/^[a-z]{3}$/)})})});
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;if(!z.uuid().safeParse(id).success)return fail('not_found','Unknown endpoint.',404);
 if(!(await checkRateLimit('integration-inbound:'+id,60,60)).allowed)return fail('rate_limited','Too many requests.',429,{headers:{'Retry-After':'60'}});
 try{
  const db=createAdminClient();
  // Identidade do endpoint é resolvida pelo servidor. Nenhuma org vem do corpo.
  const {data,error}=await db.from('integration_connections').select('id,provider,label,revision,active,auth_kind,validated_at,failure_code,organization_id').eq('id',id).eq('active',true).maybeSingle();
  if(error)throw new Error('storage');
  if(!data||!['stripe','inbound_webhook'].includes(data.provider))return fail('not_found','Unknown endpoint.',404);
  const org=data.organization_id as string;const connection=data as PublicConnection;
  const credential=await readConnectionCredential(db,org,connection);const raw=await boundedBody(req);
  const stripe=data.provider==='stripe';
  const secret=stripe?apiCredentialSchemas.stripe.parse(JSON.parse(credential)).webhook_secret:apiCredentialSchemas.inbound_webhook.parse(JSON.parse(credential)).signing_secret;
  if(!secret||!verifyEventSignature(raw,req.headers.get(stripe?'stripe-signature':'x-integration-signature'),secret,stripe))return fail('forbidden','Invalid signature.',403);
  let event:z.infer<typeof inboundEventSchema>;
  if(stripe){
   const parsed=JSON.parse(raw);const type=z.object({type:z.string()}).parse(parsed).type;
   // Checkout natif: la signature est déjà vérifiée, le tenant vient du coffre.
   const native = checkoutEventSchema.safeParse(parsed);
   if (native.success) {
    const outcome = await applyCheckoutPaymentEvent(getRequestPool(), { organizationId: org, connectionId: id, revision: connection.revision }, native.data);
    return ok(outcome);
   }
   if(!['checkout.session.completed','checkout.session.async_payment_succeeded','checkout.session.async_payment_failed'].includes(type))return ok({outcome:'ignored'});
   const verified=stripeEvent.parse(parsed);const session=verified.data.object;
   // Só links criados nesta conexão/organização podem confirmar pagamentos aqui.
   const known=await db.from('integration_executions').select('id').eq('organization_id',org).eq('connection_id',id).eq('action','create_payment_link').eq('status','succeeded').contains('output',{id:session.payment_link}).limit(1);
   if(known.error)throw new Error('storage');
   if(!known.data?.length)return fail('conflict','Payment link is not owned by this connection.',409);
   event={id:verified.id,event:verified.type,data:{session_id:session.id,payment_link:session.payment_link,payment_status:session.payment_status,amount_total_cents:session.amount_total,currency:session.currency.toUpperCase()}};
  }else event=inboundEventSchema.parse(JSON.parse(raw));
  const outcome=await recordInboundEvent(createSupabaseIntegrationStore(db),org,connection,event);
  if(outcome==='conflict')return fail('conflict','Event ID already has different data.',409);
  if(outcome==='busy')return fail('service_unavailable','Event is awaiting reconciliation.',503);
  if(outcome==='recorded')await audit({action:'integration.event_received',organizationId:org,resourceType:'integration_connection',resourceId:id,metadata:{provider:data.provider}});
  return ok({outcome});
 }catch(error){
  if(error instanceof z.ZodError||error instanceof SyntaxError||(error instanceof Error&&error.message==='invalid_body'))return fail('validation_failed','Invalid event.',422);
  return fail('service_unavailable','Event could not be recorded. Retry later.',503);
 }
}
