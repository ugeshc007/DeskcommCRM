import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/lib/env", () => ({ env: { SAAS_BILLING_WEBHOOK_SECRET: "s".repeat(32) } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc }) }));

import { POST } from "./route";

const payload = JSON.stringify({
  external_event_ref: "evt_1",
  external_subscription_ref: "sub_1",
  plan_code: "pro",
  status: "active",
  occurred_at: "2026-09-12T12:00:00.000Z",
});

function request(signature?: string) {
  return new Request("http://localhost/api/v1/webhooks/billing/manual", {
    method: "POST",
    headers: signature ? { "x-billing-signature": signature } : {},
    body: payload,
  });
}

describe("POST billing webhook", () => {
  beforeEach(() => { rpc.mockReset(); rpc.mockResolvedValue({ data: { outcome: "applied" }, error: null }); });

  it("recusa assinatura ausente antes do banco", async () => {
    const response = await POST(request() as never, { params: Promise.resolve({ provider: "manual" }) });
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("normaliza e entrega somente referências externas ao RPC", async () => {
    const signature = createHmac("sha256", "s".repeat(32)).update(payload).digest("hex");
    const response = await POST(request(signature) as never, { params: Promise.resolve({ provider: "manual" }) });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("fn_apply_saas_provider_event", { p_event: expect.objectContaining({ provider: "manual", external_event_ref: "evt_1", external_subscription_ref: "sub_1" }) });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("organization_id");
  });

  it("não aceita provider sem adapter", async () => {
    const response = await POST(request("0".repeat(64)) as never, { params: Promise.resolve({ provider: "stripe" }) });
    expect(response.status).toBe(404);
  });
});
