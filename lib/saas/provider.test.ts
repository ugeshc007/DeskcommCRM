import { describe, expect, it } from "vitest";
import { BillingCapabilityUnavailableError, manualBillingProvider } from "./provider";

describe("manualBillingProvider", () => {
  it("não promete checkout nem portal", async () => {
    expect(manualBillingProvider.supportsCheckout).toBe(false);
    await expect(manualBillingProvider.createCheckout({ organizationId: "x", returnUrl: "https://example.test" })).rejects.toBeInstanceOf(BillingCapabilityUnavailableError);
  });
  it("normaliza somente o contrato estrito", async () => {
    const event = await manualBillingProvider.normalizeWebhook({ external_event_ref: "evt_1", external_subscription_ref: "sub_1", plan_code: "pro", status: "active", occurred_at: "2026-09-12T10:00:00.000Z" }, new Headers());
    expect(event).toMatchObject({ provider: "manual", externalEventRef: "evt_1", externalSubscriptionRef: "sub_1", planCode: "pro" });
    await expect(manualBillingProvider.normalizeWebhook({ external_event_ref: "evt_2", external_subscription_ref: "sub_1", organization_id: "attacker", plan_code: "pro", status: "active", occurred_at: "2026-09-12T10:00:00.000Z" }, new Headers())).rejects.toThrow();
  });
});
