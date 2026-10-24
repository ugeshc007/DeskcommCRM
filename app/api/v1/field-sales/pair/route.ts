import { z } from 'zod';
import { ok, fail } from '@/lib/api/wrappers';
import { authRateLimited } from '@/lib/auth/rate-limit';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { redeemFieldPairingCode } from '@/lib/field-sales/devices';
import { readFieldJson } from '@/lib/field-sales/request';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const inputSchema = z.strictObject({ code: z.string().regex(/^\d{6}$/) });

/** Public only at the edge: the short code is validated and redeemed atomically here. */
export async function POST(req: Request) {
  try {
    // A global bucket is necessary: without an account identifier, per-IP limits
    // alone do not stop a distributed search across the million-code space.
    if (await authRateLimited('field_pair', 'all-pairing-attempts', { ip: 6, id: 50, windowSec: 300 }))
      return fail('rate_limited', 'Too many pairing attempts. Request a new code and try later.', 429,
        { headers: { ...headers, 'Retry-After': '300' } });
    const { code } = inputSchema.parse(await readFieldJson(req));
    return ok(await redeemFieldPairingCode(getRequestPool(), code), { headers });
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError || (error instanceof Error && error.message === 'field_pairing_invalid'))
      return fail('unauthenticated', 'Code invalid, expired, or already used. Request a new code.', 401, { headers });
    return fail('service_unavailable', 'Pairing is temporarily unavailable. Request a new code later.', 503, { headers });
  }
}
