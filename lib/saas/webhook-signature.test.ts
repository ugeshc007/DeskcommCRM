import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyBillingWebhookSignature } from "./webhook-signature";

describe("billing webhook signature", () => {
  it("aceita somente HMAC SHA-256 do corpo exato", () => {
    const body = '{"event":"synthetic"}'; const secret = "test-only-secret";
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyBillingWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyBillingWebhookSignature(`${body} `, signature, secret)).toBe(false);
  });
  it("recusa formato inválido e secret ausente", () => {
    expect(verifyBillingWebhookSignature("{}", "no", "secret")).toBe(false);
    expect(verifyBillingWebhookSignature("{}", "00".repeat(32), "")).toBe(false);
  });
});
