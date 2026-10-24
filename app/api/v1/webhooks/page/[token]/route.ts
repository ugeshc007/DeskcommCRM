import { createAdminClient } from '@/lib/supabase/admin';
import { fail, ok } from '@/lib/api/wrappers';
import { checkRateLimit } from '@/lib/ai/dispatcher/rate-limit';
import { ingestPageWebhook, pageChallenge } from '@/lib/channels/messenger/webhook';

export const runtime = 'nodejs';
type Context = { params: Promise<{ token: string }> };
async function limited(token: string) {
  return /^[a-f0-9]{32}$/.test(token) && (await checkRateLimit('page-webhook:' + token, 120, 60)).allowed;
}
export async function GET(req: Request, { params }: Context) {
  const { token } = await params;
  if (!(await limited(token))) return fail('rate_limited', 'Endpoint unavailable.', 429);
  try {
    const challenge = await pageChallenge(createAdminClient(), token, new URL(req.url));
    // Protocol verification requires plain text, not the JSON API envelope.
    return challenge ? new Response(challenge, { headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' } }) : fail('forbidden', 'Verification failed.', 403);
  } catch { return fail('service_unavailable', 'Verification unavailable.', 503); }
}
export async function POST(req: Request, { params }: Context) {
  const { token } = await params;
  if (!(await limited(token))) return fail('rate_limited', 'Endpoint unavailable.', 429);
  try {
    if (!req.body) return fail('validation_failed', 'Empty event.', 422);
    const reader = req.body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break;
        size += part.value.length; if (size > 262144) return fail('payload_too_large', 'Event too large.', 413);
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    return ok(await ingestPageWebhook(createAdminClient(), token, Buffer.concat(chunks), req.headers.get('x-hub-signature-256')));
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (['invalid_webhook_signature', 'page_endpoint_unavailable', 'webhook_page_mismatch'].includes(code)) return fail('forbidden', 'Event rejected.', 403);
    if (code.startsWith('invalid_') || code === 'webhook_message_id_missing') return fail('validation_failed', 'Invalid event.', 422);
    return fail('service_unavailable', 'Event could not be recorded. Retry later.', 503);
  }
}
