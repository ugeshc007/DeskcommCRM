import type { SaasLimits, SaasPlan, SaasStatus } from "./subscription";
import { z } from "zod";

/** Contrato normalizado: provedores futuros não vazam payloads para o domínio. */
export interface NormalizedBillingEvent {
  provider: string;
  externalEventRef: string;
  externalCustomerRef?: string;
  externalSubscriptionRef?: string;
  planCode: SaasPlan;
  status: SaasStatus;
  limits?: SaasLimits;
  occurredAt: string;
}

export interface BillingProviderAdapter {
  readonly name: string;
  readonly supportsCheckout: boolean;
  readonly supportsCustomerPortal: boolean;
  createCheckout(input: { organizationId: string; returnUrl: string }): Promise<{ url: string }>;
  createCustomerPortal(input: { organizationId: string; returnUrl: string }): Promise<{ url: string }>;
  normalizeWebhook(payload: unknown, headers: Headers): Promise<NormalizedBillingEvent>;
}

export class BillingCapabilityUnavailableError extends Error {
  constructor(capability: "checkout" | "customer_portal") {
    super(`billing capability unavailable: ${capability}`);
  }
}

const normalizedEventSchema = z.object({
  external_event_ref: z.string().trim().min(1).max(200),
  external_subscription_ref: z.string().trim().min(1).max(200),
  external_customer_ref: z.string().trim().min(1).max(200).optional(),
  plan_code: z.enum(["standard", "pro", "enterprise"]),
  status: z.enum(["trialing", "active", "past_due", "canceled"]),
  limits: z.object({ members: z.number().int().nonnegative().optional(), channels: z.number().int().nonnegative().optional(), monthly_ai_cents: z.number().int().nonnegative().optional() }).strict().optional(),
  occurred_at: z.string().datetime({ offset: true }),
}).strict();

/** Adapter operável para o piloto: sem checkout fictício e sem payload livre. */
export const manualBillingProvider: BillingProviderAdapter = {
  name: "manual",
  supportsCheckout: false,
  supportsCustomerPortal: false,
  async createCheckout() { throw new BillingCapabilityUnavailableError("checkout"); },
  async createCustomerPortal() { throw new BillingCapabilityUnavailableError("customer_portal"); },
  async normalizeWebhook(payload) {
    const parsed = normalizedEventSchema.parse(payload);
    return {
      provider: "manual",
      externalEventRef: parsed.external_event_ref,
      externalCustomerRef: parsed.external_customer_ref,
      externalSubscriptionRef: parsed.external_subscription_ref,
      planCode: parsed.plan_code,
      status: parsed.status,
      limits: parsed.limits,
      occurredAt: parsed.occurred_at,
    };
  },
};

const adapters: Readonly<Record<string, BillingProviderAdapter>> = { manual: manualBillingProvider };
export function getBillingProviderAdapter(name: string): BillingProviderAdapter | null {
  return adapters[name] ?? null;
}
