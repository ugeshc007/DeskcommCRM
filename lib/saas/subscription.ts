export const SAAS_PLANS = ["standard", "pro", "enterprise"] as const;
export const SAAS_STATUSES = ["trialing", "active", "past_due", "canceled"] as const;

export type SaasPlan = (typeof SAAS_PLANS)[number];
export type SaasStatus = (typeof SAAS_STATUSES)[number];
export type SaasLimits = Partial<Record<"members" | "channels" | "monthly_ai_cents", number>>;

export interface OrganizationSubscription {
  id: string;
  organization_id: string;
  plan_code: SaasPlan;
  status: SaasStatus;
  billing_provider: string;
  external_customer_ref: string | null;
  external_subscription_ref: string | null;
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  limits: SaasLimits;
  revision: number;
  created_at: string;
  updated_at: string;
}

export interface OrganizationBillingEvent {
  id: string;
  event_type: "subscription_created" | "subscription_updated" | "provider_event";
  previous_status: SaasStatus | null;
  new_status: SaasStatus | null;
  occurred_at: string;
  summary: Record<string, unknown>;
}

export interface SaasNotice {
  code: "subscription_missing" | "past_due" | "canceled" | "limit_reached";
  severity: "info" | "warning";
  message: string;
  resource?: EntitlementResource;
}

export type EntitlementResource = keyof SaasLimits;

export type SaasDeploymentMode = "self_hosted" | "managed_saas";

export interface EntitlementDecision {
  allowed: boolean;
  configured: boolean;
  lifecycle: SaasStatus | null;
  limit: number | null;
  remaining: number | null;
  reason: "subscription_missing" | "subscription_malformed" | "plan_limit_reached" | null;
}

/**
 * Decisão pura da catraca SaaS. O lifecycle é sempre informativo: past_due e
 * canceled não suspendem o tenant sem uma ação explícita da plataforma.
 */
export function evaluateEntitlement(input: {
  deploymentMode?: SaasDeploymentMode;
  subscription: Pick<OrganizationSubscription, "status" | "limits"> | null | undefined;
  resource: EntitlementResource;
  used: number;
  requested?: number;
}): EntitlementDecision {
  const lifecycle = input.subscription?.status ?? null;
  if ((input.deploymentMode ?? "self_hosted") === "self_hosted") {
    return { allowed: true, configured: true, lifecycle, limit: null, remaining: null, reason: null };
  }
  if (!input.subscription) {
    return { allowed: true, configured: false, lifecycle: null, limit: null, remaining: null, reason: "subscription_missing" };
  }
  const limit = input.subscription?.limits[input.resource];
  if (limit === undefined) return { allowed: true, configured: true, lifecycle, limit: null, remaining: null, reason: null };
  if (!Number.isSafeInteger(limit) || limit < 0 || !Number.isFinite(input.used) || input.used < 0) {
    return { allowed: true, configured: false, lifecycle, limit: null, remaining: null, reason: "subscription_malformed" };
  }
  const requested = input.requested ?? 1;
  if (!Number.isSafeInteger(requested) || requested < 0) {
    return { allowed: true, configured: false, lifecycle, limit, remaining: null, reason: "subscription_malformed" };
  }
  const remaining = Math.max(0, limit - input.used);
  const allowed = input.used + requested <= limit;
  return { allowed, configured: true, lifecycle, limit, remaining, reason: allowed ? null : "plan_limit_reached" };
}
