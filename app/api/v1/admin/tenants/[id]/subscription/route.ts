import { randomUUID } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { fail, ok } from "@/lib/api/wrappers";
import { mfaEmDivida } from "@/lib/auth/server";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { evaluateEntitlement, type OrganizationBillingEvent, type OrganizationSubscription, type SaasNotice } from "@/lib/saas/subscription";
import { createAdminClient } from "@/lib/supabase/admin";

const nullableDate = z.string().datetime({ offset: true }).nullable().default(null);
const schema = z.object({
  plan_code: z.enum(["standard", "pro", "enterprise"]),
  status: z.enum(["trialing", "active", "past_due", "canceled"]),
  billing_provider: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/).default("manual"),
  external_customer_ref: z.string().trim().max(200).nullable().default(null),
  external_subscription_ref: z.string().trim().max(200).nullable().default(null),
  trial_ends_at: nullableDate,
  current_period_start: nullableDate,
  current_period_end: nullableDate,
  cancel_at_period_end: z.boolean().default(false),
  limits: z.object({
    members: z.number().int().nonnegative().optional(),
    channels: z.number().int().nonnegative().optional(),
    monthly_ai_cents: z.number().int().nonnegative().optional(),
  }).strict().default({}),
}).strict();

async function context(requestId: string) {
  try { return await requirePlatformAdmin(); }
  catch { return fail("forbidden", "Platform admin required", 403, { requestId }); }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const ctx = await context(requestId);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const admin = createAdminClient();
  const [subscriptionResult, eventsResult, membersResult, channelsResult, aiResult] = await Promise.all([
    admin.from("organization_subscriptions" as never).select("*").eq("organization_id", id).maybeSingle(),
    admin.from("organization_billing_events" as never).select("id,event_type,previous_status,new_status,occurred_at,summary").eq("organization_id", id).order("occurred_at", { ascending: false }).limit(10),
    admin.from("user_organizations").select("*", { count: "exact", head: true }).eq("organization_id", id).is("revoked_at", null),
    admin.from("channel_sessions").select("*", { count: "exact", head: true }).eq("organization_id", id).is("archived_at", null),
    admin.rpc("fn_gasto_de_ia_do_mes", { p_org: id }),
  ]);
  if (subscriptionResult.error || eventsResult.error || membersResult.error || channelsResult.error || aiResult.error) return fail("internal_error", "Could not load subscription", 500, { requestId });
  const subscription = (subscriptionResult.data as OrganizationSubscription | null) ?? null;
  const notices: SaasNotice[] = [];
  if (!subscription) notices.push({ code: "subscription_missing", severity: "info", message: "Managed mode has no subscription configuration for this tenant." });
  if (subscription?.status === "past_due") notices.push({ code: "past_due", severity: "warning", message: "Billing is past due. Customer service remains active until an explicit platform action." });
  if (subscription?.status === "canceled") notices.push({ code: "canceled", severity: "warning", message: "The subscription is canceled. Review the period and tenant status explicitly." });
  const usage = { members: membersResult.count ?? 0, channels: channelsResult.count ?? 0, monthly_ai_cents: Number(aiResult.data ?? 0) };
  for (const resource of ["members", "channels", "monthly_ai_cents"] as const) {
    const decision = evaluateEntitlement({ deploymentMode: "managed_saas", subscription, resource, used: usage[resource], requested: 1 });
    if (!decision.allowed) notices.push({ code: "limit_reached", severity: "warning", resource, message: `${resource.replaceAll("_", " ")} has reached its configured limit (${decision.limit}). Increase or remove the limit to recover.` });
  }
  return ok({ subscription, events: (eventsResult.data as OrganizationBillingEvent[] | null) ?? [], notices, usage }, { requestId });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  const { id } = await params;
  const denied = await requireSupportWrite(id);
  if (denied) return denied;
  const ctx = await context(requestId);
  if (ctx instanceof Response) return ctx;
  if (ctx.platformAdmin.scope !== "full") return fail("forbidden", "Full platform access required", 403, { requestId });
  if (await mfaEmDivida()) return fail("mfa_required", "Confirm two-step verification", 403, { requestId });
  const key = req.headers.get("Idempotency-Key");
  if (!key || !z.string().uuid().safeParse(key).success) return fail("validation_error", "A UUID Idempotency-Key header is required", 400, { requestId });
  let raw: unknown;
  try { raw = await req.json(); } catch { return fail("validation_error", "Invalid JSON body", 400, { requestId }); }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) return fail("validation_error", "Invalid subscription", 400, { requestId, details: parsed.error.flatten() });
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("fn_set_organization_subscription" as never, {
    p_actor: ctx.user.id, p_organization_id: id, p_idempotency_key: key, p_request: parsed.data,
  } as never);
  if (error) {
    if (error.code === "P0002") return fail("not_found", "Tenant not found", 404, { requestId });
    if (error.code === "22023" || error.code === "23514") return fail("validation_error", "Invalid subscription", 400, { requestId });
    return fail("internal_error", "Could not update subscription", 500, { requestId });
  }
  const subscription = data as OrganizationSubscription & { created: boolean; replayed: boolean };
  if (!subscription.replayed) await audit({ action: "platform_admin.subscription_updated", actorUserId: ctx.user.id, actingAsPlatformAdmin: true, bypassedRls: true, organizationId: id, resourceType: "organization_subscription", resourceId: subscription.id, requestId, metadata: { plan_code: subscription.plan_code, status: subscription.status, revision: subscription.revision } });
  return ok({ subscription }, { requestId });
}
