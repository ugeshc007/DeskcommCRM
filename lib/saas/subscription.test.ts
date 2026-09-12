import { describe, expect, it } from "vitest";
import { evaluateEntitlement } from "./subscription";

describe("evaluateEntitlement", () => {
  it("preserva self-host quando não há assinatura", () => {
    expect(evaluateEntitlement({ subscription: null, resource: "members", used: 999 }).allowed).toBe(true);
  });
  it("deixa passar mas torna visível assinatura ausente no modo gerenciado", () => {
    expect(evaluateEntitlement({ deploymentMode: "managed_saas", subscription: null, resource: "members", used: 2 })).toMatchObject({
      allowed: true, configured: false, reason: "subscription_missing",
    });
  });
  it("preserva recurso sem limite configurado", () => {
    expect(evaluateEntitlement({ deploymentMode: "managed_saas", subscription: { status: "active", limits: {} }, resource: "channels", used: 3 }).limit).toBeNull();
  });
  it("nega somente quando o teto explícito seria ultrapassado", () => {
    const subscription = { status: "active" as const, limits: { members: 2 } };
    expect(evaluateEntitlement({ deploymentMode: "managed_saas", subscription, resource: "members", used: 1 }).allowed).toBe(true);
    expect(evaluateEntitlement({ deploymentMode: "managed_saas", subscription, resource: "members", used: 2 }).allowed).toBe(false);
  });
  it("falha aberto e visível quando a configuração não é segura", () => {
    expect(evaluateEntitlement({ deploymentMode: "managed_saas", subscription: { status: "past_due", limits: { members: Number.NaN } }, resource: "members", used: 1 })).toMatchObject({
      allowed: true, configured: false, lifecycle: "past_due", reason: "subscription_malformed",
    });
  });
});
