import { z } from 'zod';
import { env } from '@/lib/env';
import { ok, fail } from '@/lib/api/wrappers';
import { authRateLimited } from '@/lib/auth/rate-limit';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { authenticateFieldDevice } from '@/lib/field-sales/devices';
import { fieldTransaction, requireFieldEmployee, withFieldDevice } from '@/lib/field-sales/authority';
import { fieldVoiceBase, readFieldVoiceAudio } from '@/lib/field-sales/voice';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
const transcriptSchema = z.strictObject({ text: z.string().trim().max(500) });

async function handle(req: Request, prompt: boolean) {
  const authorization = req.headers.get('authorization');
  try {
    if (await authRateLimited('field_voice', authorization, { ip: 20, id: 10, windowSec: 60 }))
      return fail('rate_limited', 'Wait a minute before speaking again.', 429, { headers });
    const service = fieldVoiceBase(env.FIELD_VOICE_URL);
    if (!service || !env.INTERNAL_SECRET) return fail('service_unavailable', 'Voice is unavailable. Choose a project by touch.', 503, { headers });
    const pool = getRequestPool();
    const auth = await authenticateFieldDevice(pool, authorization);
    return await withFieldDevice(auth, async () => {
      await fieldTransaction(pool, auth.org, auth.actor, async db => {
        await requireFieldEmployee(db, auth.org, auth.actor);
        const active = await db.query(`select 1 from public.field_sales_sessions s
          join public.field_sales_settings policy on policy.organization_id=s.organization_id
          where s.organization_id=$1 and s.employee_id=$2 and s.punched_out_at is null
            and s.punched_in_at>now()-interval '14 hours' and policy.enabled limit 1`, [auth.org, auth.actor]);
        if (!active.rowCount) throw new Error('field_work_session_required');
      });
      const audio = prompt ? undefined : await readFieldVoiceAudio(req);
      const upstream = await fetch(`${service}/${prompt ? 'prompt' : 'transcribe'}`, {
        method: prompt ? 'GET' : 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25_000),
        headers: { 'X-Internal-Secret': env.INTERNAL_SECRET, ...(audio ? { 'Content-Type': 'audio/mp4' } : {}) },
        body: audio ? Uint8Array.from(audio).buffer : undefined,
      });
      if (!upstream.ok) throw new Error('field_voice_unavailable');
      if (prompt) {
        const bytes = await upstream.arrayBuffer();
        if (bytes.byteLength < 128 || bytes.byteLength > 256_000) throw new Error('field_voice_unavailable');
        return new Response(bytes, { headers: { ...headers, 'Content-Type': 'audio/wav' } });
      }
      const data = transcriptSchema.parse(await upstream.json());
      return ok({ text: data.text }, { headers });
    });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'field_device_unauthorized' || code === 'field_forbidden' || code === 'field_employee_unavailable')
      return fail('unauthenticated', 'Reconnect your Android device.', 401, { headers });
    if (code === 'field_work_session_required') return fail('state_conflict', 'Punch in before using voice.', 409, { headers });
    if (code === 'field_voice_invalid_audio') return fail('validation_failed', 'Record a short answer and try again.', 422, { headers });
    return fail('service_unavailable', 'Voice is unavailable. Choose a project by touch.', 503, { headers });
  }
}

export function GET(req: Request) { return handle(req, true); }
export function POST(req: Request) { return handle(req, false); }
