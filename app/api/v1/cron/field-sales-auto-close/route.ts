import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { ok, fail } from '@/lib/api/wrappers';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { closeExpiredFieldSessions } from '@/lib/field-sales/auto-close';
import { env } from '@/lib/env';
import { logger } from '@/lib/logger';

export const dynamic = 'force-dynamic';
function authorized(value: string | null) {
  if (!value?.startsWith('Bearer ')) return false;
  const candidate = Buffer.from(value.slice(7));
  return [env.INTERNAL_CRON_SECRET, env.INTERNAL_SECRET].filter(Boolean).some(secret => {
    const expected = Buffer.from(secret);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}
export async function GET(req: NextRequest) {
  const requestId = randomUUID();
  if (!authorized(req.headers.get('authorization')))
    return fail('forbidden', 'Cron secret missing or invalid.', 403, { requestId });
  try { return ok(await closeExpiredFieldSessions(getRequestPool()), { requestId }); }
  catch (error) {
    logger.error('[field-sales-auto-close] failed', { requestId, error: error instanceof Error ? error.message : 'unknown' });
    return fail('internal_error', 'Could not close expired work sessions.', 500, { requestId });
  }
}
