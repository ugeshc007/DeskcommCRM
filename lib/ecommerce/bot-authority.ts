import type { Queryable } from '@/lib/agent-engine/queue/queue';
import type { JobClaim } from '@/lib/agent-engine/queue/claim';
import type { ServiceBoundary } from '@/lib/atendimento/fronteira';
import { requireCurrentServiceBoundary } from '@/lib/atendimento/fronteira-server';
import { decidirElegibilidade, montarEstadoDeElegibilidade, ttlDaAutorizacaoMs } from '@/lib/ai/elegibilidade/gate';

/** Só o runtime do job fornece este contexto; nunca o JSON do cliente/modelo. */
export interface StoreBotContext { jobId: string; claim: JobClaim; boundary: ServiceBoundary }

export async function assertStoreBot(db: Queryable, org: string, context: StoreBotContext) {
  if (context.boundary.organization_id !== org) throw new Error('store_bot_forbidden');
  const result = await db.query(`select j.payload,m.id message_id,m.body,m.created_at,
    c.id contact_id,c.force_human,c.ai_authorized_at,c.phone_number,
    v.id conversation_id,v.assignee_kind,v.bot_silenced_until,s.metadata
    from public.job_queue j
    join public.messages m on m.organization_id=j.organization_id and m.id::text=j.payload->>'inbound_message_id'
    join public.contacts c on c.organization_id=j.organization_id and c.id=j.contact_id and c.id=m.contact_id
    join public.conversations v on v.organization_id=j.organization_id and v.id=m.conversation_id
    join public.channel_sessions s on s.organization_id=j.organization_id and s.id=m.channel_session_id
    join public.store_settings st on st.organization_id=j.organization_id
    where j.organization_id=$1 and j.id=$2 and j.status='running' and j.kind='inbound_turn'
      and j.locked_by=$3 and j.locked_at=$4::timestamptz and m.direction='inbound'
      and not c.is_blocked and not c.is_anonymized and c.is_merged_into is null
      and s.archived_at is null and st.active and st.automated_checkout
      and not exists(select 1 from public.messages newer where newer.organization_id=j.organization_id
        and newer.conversation_id=v.id and newer.direction='inbound' and newer.created_at>m.created_at)
      and v.id=$5 and c.id=$6 for share of j,c,v,s,st`,
  [org, context.jobId, context.claim.worker_id, context.claim.acquired_at, context.boundary.conversation_id, context.boundary.contact_id]);
  const row = result.rows[0];
  if (!row) throw new Error('store_bot_forbidden');
  await requireCurrentServiceBoundary(db, context.boundary);
  const meta = row.metadata ?? {};
  const eligibility = decidirElegibilidade(montarEstadoDeElegibilidade({ aiGate: meta.ai_gate,
    aiGateMode: meta.ai_gate_mode, aiTestPhoneNumbers: meta.ai_test_phone_numbers, contactPhoneNumber: row.phone_number,
    forceHuman: row.force_human, assigneeKind: row.assignee_kind, botSilencedUntil: row.bot_silenced_until,
    aiAuthorizedAt: row.ai_authorized_at, agora: new Date(), ttlMs: ttlDaAutorizacaoMs(process.env) }));
  if (!eligibility.permite) throw new Error('store_bot_forbidden');
  return { contactId: row.contact_id as string, conversationId: row.conversation_id as string,
    messageId: row.message_id as string, body: row.body as string | null, createdAt: row.created_at as Date };
}
