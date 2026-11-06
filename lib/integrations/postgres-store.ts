import type pg from 'pg';
import { z } from 'zod';
import { openCredential,sealCredential } from './vault';
import { consumeCurrentCredential } from './refresh-credential';
import type { IntegrationExecutionStore } from './execution';

const failureSchema = z.enum(['connection_unavailable', 'provider_rejected', 'invalid_output', 'reconciliation_required']);
export const claimResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('acquired'), lease: z.uuid() }),
  z.strictObject({ kind: z.literal('completed'), output: z.unknown() }),
  z.strictObject({ kind: z.literal('failed'), code: failureSchema }),
  z.strictObject({ kind: z.literal('conflict') }), z.strictObject({ kind: z.literal('busy') }), z.strictObject({ kind: z.literal('indeterminate') }),
]);

/** O pool pertence ao chamador server/worker. Não cria conexão nem fallback local.
 * Todas as consultas service-role carregam organização explícita, inclusive joins.
 */
export function createPostgresIntegrationStore(db: Pick<pg.Pool, 'query'>): IntegrationExecutionStore {
  return {
    async readEvent(organizationId, connectionId, eventId) {
      const result = await db.query<{output:unknown}>("select output from public.integration_executions where organization_id=$1 and connection_id=$2 and execution_key=$3 and action='received_event' and status='succeeded'",[organizationId,connectionId,`inbound:${connectionId}:${eventId}`]);
      return result.rows[0]?.output??null;
    },
    async connection(organizationId, connectionId) {
      const result = await db.query<{ id: string; organizationId: string; provider: string; revision: number; active: boolean }>(
        'select id,organization_id as "organizationId",provider,revision,active from public.integration_connections where organization_id=$1 and id=$2',
        [organizationId, connectionId]);
      return result.rows[0] ?? null;
    },
    async claim(scope, fingerprint, retry, identity) {
      const result = await db.query<{ result: unknown }>(
        'select public.fn_integration_claim($1,$2,$3,$4,$5,$6,$7) result',
        [scope.organizationId, scope.executionKey, identity.connectionId, identity.revision, identity.action, fingerprint, retry]);
      return claimResultSchema.parse(result.rows[0]?.result);
    },
    async withCredential(organizationId, connectionId, revision, consume) {
      const result = await db.query<{ ciphertext: Buffer; iv: Buffer; tag: Buffer; provider:string }>(
        `select s.ciphertext,s.iv,s.tag,c.provider from public.integration_credentials s
         join public.integration_connections c on c.organization_id=s.organization_id and c.id=s.connection_id
         where s.organization_id=$1 and c.organization_id=$1 and s.connection_id=$2 and c.id=$2
          and s.revision=$3 and c.revision=$3 and c.active`, [organizationId, connectionId, revision]);
      const sealed = result.rows[0];
      if (!sealed) throw new Error('integration_credential_unavailable');
      const identity={organizationId,connectionId,revision};
      return consumeCurrentCredential(sealed.provider,openCredential(identity,sealed),async renewed=>{
        const next=sealCredential(identity,renewed);
        const saved=await db.query('update public.integration_credentials set ciphertext=$4,iv=$5,tag=$6 where organization_id=$1 and connection_id=$2 and revision=$3 and tag=$7 returning connection_id',[organizationId,connectionId,revision,next.ciphertext,next.iv,next.tag,sealed.tag]);
        return saved.rowCount===1;
      },consume);
    },
    async finish(scope, lease, result) {
      await db.query('select public.fn_integration_finish($1,$2,$3,$4,$5::jsonb,$6)', [
        scope.organizationId, scope.executionKey, lease, result.status,
        result.status === 'succeeded' ? JSON.stringify(result.output) : null,
        result.status === 'succeeded' ? null : result.code,
      ]);
    },
  };
}
