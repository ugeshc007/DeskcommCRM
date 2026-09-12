import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { getBillingProviderAdapter } from "@/lib/saas/provider";
import { verifyBillingWebhookSignature } from "@/lib/saas/webhook-signature";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const requestId = randomUUID();
  const { provider } = await params;
  const adapter = getBillingProviderAdapter(provider);
  if (!adapter) return fail("not_found", "Billing provider not configured", 404, { requestId });
  const secret = env.SAAS_BILLING_WEBHOOK_SECRET;
  if (secret.length < 32) return fail("service_unavailable", "Billing webhook is not configured", 503, { requestId });
  const rawBody = await req.text();
  if (!verifyBillingWebhookSignature(rawBody, req.headers.get("x-billing-signature"), secret)) {
    return fail("forbidden", "Invalid billing webhook signature", 403, { requestId });
  }
  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return fail("validation_error", "Invalid JSON body", 400, { requestId }); }
  let event;
  try { event = await adapter.normalizeWebhook(payload, req.headers); }
  catch (error) {
    return fail("validation_error", "Invalid billing event", 400, { requestId, details: error instanceof z.ZodError ? error.flatten() : undefined });
  }
  const { data, error } = await createAdminClient().rpc("fn_apply_saas_provider_event" as never, {
    p_event: {
      provider: event.provider,
      external_event_ref: event.externalEventRef,
      external_customer_ref: event.externalCustomerRef ?? null,
      external_subscription_ref: event.externalSubscriptionRef,
      plan_code: event.planCode,
      status: event.status,
      limits: event.limits ?? null,
      occurred_at: event.occurredAt,
    },
  } as never);
  if (error) return fail("internal_error", "Could not record billing event", 500, { requestId });
  return ok(data as { outcome: "applied" | "duplicate" | "stale" | "unknown_subscription" }, { requestId });
}
