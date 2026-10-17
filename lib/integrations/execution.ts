import { createHash } from 'node:crypto';
import { z } from 'zod';

/** Contrato interno: organização é obtida pelo guard, nunca pelo grafo/payload. */
export interface ExecutionScope { organizationId: string; executionKey: string }
export interface ConnectionIdentity { id: string; organizationId: string; provider: string; revision: number; active: boolean }
export type RetryClass = 'read_only' | 'provider_idempotent' | 'never';
export type FailureCode = 'connection_unavailable' | 'action_unavailable' | 'invalid_input' | 'execution_conflict' | 'in_progress' | 'reconciliation_required' | 'provider_rejected' | 'invalid_output';
export type ExecutionResult = { status: 'succeeded'; output: unknown; replayed: boolean }
  | { status: 'failed' | 'pending'; code: FailureCode };

export interface ConnectorAction {
  provider: string;
  action: string;
  retry: RetryClass;
  input: z.ZodType;
  /** Projeção explícita do resultado: nunca devolver Response/headers crus. */
  output: z.ZodType;
  execute(input: unknown, context: { credential: string; idempotencyKey: string; readEvent?: (eventId: string) => Promise<unknown> }): Promise<unknown>;
}

export type ClaimResult = { kind: 'acquired'; lease: string }
  | { kind: 'completed'; output: unknown }
  | { kind: 'failed'; code: FailureCode }
  | { kind: 'conflict' } | { kind: 'busy' } | { kind: 'indeterminate' };

/** Implementação de banco deve usar unique(org,key) e compare-and-set da lease.
 * Não há implementação em memória usada em produção nem TTL que apague dúvida.
 * O resultado pertence à organização; histórico público guarda só status/código.
 */
export interface IntegrationExecutionStore {
  readEvent?(organizationId: string, connectionId: string, eventId: string): Promise<unknown>;
  connection(organizationId: string, connectionId: string): Promise<ConnectionIdentity | null>;
  claim(scope: ExecutionScope, fingerprint: string, retry: RetryClass, identity: { connectionId: string; revision: number; action: string }): Promise<ClaimResult>;
  withCredential<T>(organizationId: string, connectionId: string, revision: number, consume: (credential: string) => Promise<T>): Promise<T>;
  finish(scope: ExecutionScope, lease: string, result:
    { status: 'succeeded'; output: unknown } | { status: 'failed' | 'indeterminate'; code: FailureCode }): Promise<void>;
}

/** Rejeição comprovada SEM efeito, criada pelo adapter, nunca de texto do provedor. */
export class ConnectorRejected extends Error { constructor() { super('provider_rejected'); } }

const requestSchema = z.strictObject({ connectionId: z.uuid(), revision: z.number().int().positive(), action: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), input: z.unknown() });
const scopeSchema = z.strictObject({ organizationId: z.uuid(), executionKey: z.string().min(1).max(200) });

function stableJson(value: unknown, depth = 0): string {
  if (depth > 12) throw new Error('invalid_input');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item, depth + 1)).join(',')}]`;
  if (typeof value === 'object' && value && Object.getPrototypeOf(value) === Object.prototype)
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key], depth + 1)}`).join(',')}}`;
  throw new Error('invalid_input');
}

/** Não faz retry cego. A chave estável é entregue a adapters idempotentes;
 * recuperação de lease ambígua pertence ao ledger/reconciliação, nunca ao LLM.
 */
export async function executeIntegration(
  scope: ExecutionScope,
  raw: unknown,
  actions: readonly ConnectorAction[],
  store: IntegrationExecutionStore,
): Promise<ExecutionResult> {
  const parsedScope = scopeSchema.safeParse(scope);
  const request = requestSchema.safeParse(raw);
  if (!parsedScope.success || !request.success) return { status: 'failed', code: 'invalid_input' };
  const { connectionId, revision, action: actionId } = request.data;
  const connection = await store.connection(scope.organizationId, connectionId);
  if (!connection || connection.id !== connectionId || connection.organizationId !== scope.organizationId || !connection.active || connection.revision !== revision)
    return { status: 'failed', code: 'connection_unavailable' };
  const action = actions.find(item => item.provider === connection.provider && item.action === actionId);
  if (!action) return { status: 'failed', code: 'action_unavailable' };
  const input = action.input.safeParse(request.data.input);
  if (!input.success) return { status: 'failed', code: 'invalid_input' };
  let canonical: string;
  try {
    canonical = stableJson({ connectionId, revision, provider: connection.provider, action: actionId, input: input.data });
    if (Buffer.byteLength(canonical) > 262144) return { status: 'failed', code: 'invalid_input' };
  } catch { return { status: 'failed', code: 'invalid_input' }; }
  const fingerprint = createHash('sha256').update(canonical).digest('hex');
  const claim = await store.claim(scope, fingerprint, action.retry, { connectionId, revision, action: actionId });
  if (claim.kind === 'failed') return { status: 'failed', code: claim.code };
  if (claim.kind === 'conflict') return { status: 'failed', code: 'execution_conflict' };
  if (claim.kind === 'busy') return { status: 'pending', code: 'in_progress' };
  if (claim.kind === 'indeterminate') return { status: 'pending', code: 'reconciliation_required' };
  if (claim.kind === 'completed') {
    const saved = action.output.safeParse(claim.output);
    return saved.success ? { status: 'succeeded', output: saved.data, replayed: true } : { status: 'pending', code: 'reconciliation_required' };
  }
  // Releitura após claim: rotação/desconexão durante a fila invalida a execução.
  const current = await store.connection(scope.organizationId, connectionId);
  if (!current || current.id !== connectionId || current.organizationId !== scope.organizationId || current.provider !== connection.provider || !current.active || current.revision !== revision) {
    await store.finish(scope, claim.lease, { status: 'failed', code: 'connection_unavailable' });
    return { status: 'failed', code: 'connection_unavailable' };
  }
  const idempotencyKey = createHash('sha256').update(JSON.stringify([scope.organizationId, scope.executionKey, fingerprint])).digest('hex');
  let result: unknown;
  try {
    result = await store.withCredential(scope.organizationId, connectionId, revision,
      credential => action.execute(input.data, { credential, idempotencyKey, readEvent: store.readEvent ? eventId => store.readEvent!(scope.organizationId, connectionId, eventId) : undefined }));
  } catch (error) {
    const rejected = error instanceof ConnectorRejected;
    const code = rejected ? 'provider_rejected' : 'reconciliation_required';
    await store.finish(scope, claim.lease, { status: rejected ? 'failed' : 'indeterminate', code });
    return { status: rejected ? 'failed' : 'pending', code };
  }
  const output = action.output.safeParse(result);
  if (!output.success) {
    await store.finish(scope, claim.lease, { status: 'indeterminate', code: 'invalid_output' });
    return { status: 'pending', code: 'invalid_output' };
  }
  // Uma falha de persistência aqui NÃO repete a ação. A claim fica pendente e
  // o próximo worker precisa reconciliar a mesma identidade com o provedor.
  await store.finish(scope, claim.lease, { status: 'succeeded', output: output.data });
  return { status: 'succeeded', output: output.data, replayed: false };
}
