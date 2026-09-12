import { createAdminClient } from "@/lib/supabase/admin";
import { env } from "@/lib/env";
import { resolveSaasDeploymentMode } from "./deployment-mode";
import { evaluateEntitlement, type EntitlementResource, type OrganizationSubscription } from "./subscription";

export class SaasCapacityError extends Error {
  constructor(public readonly code: "plan_limit_reached" | "saas_configuration_unavailable", public readonly resource: EntitlementResource, public readonly limit?: number) { super(code); }
}

/** Fronteira server-side comum. organizationId deve vir de JWT/path confiável. */
export async function assertSaasCapacity(organizationId: string, resource: "members" | "channels", requested = 1): Promise<void> {
  if (resolveSaasDeploymentMode(env.SAAS_DEPLOYMENT_MODE) === "self_hosted") return;
  const admin = createAdminClient();
  const subscriptionResult = await admin.from("organization_subscriptions" as never).select("status, limits").eq("organization_id", organizationId).maybeSingle();
  if (subscriptionResult.error) throw new SaasCapacityError("saas_configuration_unavailable", resource);
  const subscription = subscriptionResult.data as Pick<OrganizationSubscription, "status" | "limits"> | null;
  const deploymentMode = resolveSaasDeploymentMode(env.SAAS_DEPLOYMENT_MODE);
  if (!subscription?.limits || subscription.limits[resource] === undefined) return;
  const table = resource === "members" ? "user_organizations" : "channel_sessions";
  let query = admin.from(table).select("*", { count: "exact", head: true }).eq("organization_id", organizationId);
  query = resource === "members" ? query.is("revoked_at", null) : query.is("archived_at", null);
  const usage = await query;
  if (usage.error) throw new SaasCapacityError("saas_configuration_unavailable", resource);
  const decision = evaluateEntitlement({ deploymentMode, subscription, resource, used: usage.count ?? 0, requested });
  if (!decision.allowed) throw new SaasCapacityError("plan_limit_reached", resource, decision.limit ?? undefined);
}
