import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/require-role';
import { requireSupportWrite } from '@/lib/impersonate/support';
import { createAdminClient } from '@/lib/supabase/admin';
import { getRequestPool } from '@/lib/agent-engine/db/request-pool';
import { ok, fail } from '@/lib/api/wrappers';
import { installStoreDraft } from '@/lib/ecommerce/install';
import { storeLocaleSchema } from '@/lib/ecommerce/config';
import { PROVIDERS_DE_MENSAGEM } from '@/lib/channels/capabilities';
import { readIntegrationJson } from '../integration-connections/_shared';

export const dynamic = 'force-dynamic';

export async function GET() {
  const requestId = randomUUID();
  const auth = await requireRole('admin', { requestId, resource: 'ecommerce_template' });
  if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Use an organization administrator account for store setup.', 403, { requestId });
  try {
    const db = createAdminClient();
    const [org, channels, credentials] = await Promise.all([
      db.from('organizations').select('onboarding_state,currency,timezone').eq('id', auth.org.orgId).single(),
      db.from('channel_sessions').select('id,display_name').eq('organization_id', auth.org.orgId).is('archived_at', null).in('provider', [...PROVIDERS_DE_MENSAGEM]),
      db.from('ai_provider_credentials_safe').select('id,provider,label').eq('organization_id', auth.org.orgId),
    ]);
    if (org.error || channels.error || credentials.error || !org.data) throw new Error('storage_unavailable');
    const state = z.object({ welcome: z.object({ country_code: z.string() }).passthrough() }).passthrough().safeParse(org.data.onboarding_state);
    const regional = storeLocaleSchema.safeParse({ country_code: state.success ? state.data.welcome.country_code : null, currency: org.data.currency, timezone: org.data.timezone });
    return ok({ locale: regional.success ? regional.data : null, channels: channels.data, credentials: credentials.data }, { requestId, headers: { 'Cache-Control': 'no-store' } });
  } catch { return fail('internal_error', 'Store setup could not be loaded. Please retry.', 503, { requestId }); }
}

export async function POST(req: Request) {
  const denied = await requireSupportWrite(); if (denied) return denied;
  const requestId = randomUUID();
  const auth = await requireRole('admin', { requestId, resource: 'ecommerce_template' });
  if (!auth.ok) return auth.response;
  if (auth.user.support) return fail('forbidden', 'Use an organization administrator account for store setup.', 403, { requestId });
  try {
    const input = await readIntegrationJson(req);
    const result = await installStoreDraft(getRequestPool(), auth.org.orgId, auth.user.id, input);
    return ok(result, { requestId, status: result.created ? 201 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (error instanceof z.ZodError || error instanceof SyntaxError || message === 'invalid_request')
      return fail('validation_failed', 'Review the store fields. No installation was saved.', 422, { requestId });
    if (message === 'store_forbidden') return fail('forbidden', 'Current organization administrator access is required.', 403, { requestId });
    const corrections: Record<string, string> = {
      store_region_required: 'Set your organization country, currency and time zone before installing.',
      store_channel_required: 'Select an available messaging channel owned by this organization.',
      store_credential_required: 'Select an AI credential owned by this organization and matching the provider.',
      store_policy_too_long: 'Shorten the policies so the generated agent prompt fits its 20,000-character limit.',
    };
    if (corrections[message]) return fail('validation_failed', corrections[message], 422, { requestId });
    if (message === 'store_receipt_conflict' || (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'))
      return fail('state_conflict', 'Existing store resources conflict with this installation. Nothing was overwritten. Review your agents and flows.', 409, { requestId });
    return fail('internal_error', 'Store installation could not be confirmed. Retry safely; an existing installation will not be duplicated.', 503, { requestId });
  }
}
