import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "managed_saas",
  subscription: { data: { status: "active", limits: { members: 2 } }, error: null } as { data: unknown; error: null | { message: string } },
  usage: { count: 2, error: null } as { count: number | null; error: null | { message: string } },
  tables: [] as string[],
}));
vi.mock("@/lib/env", () => ({ env: { get SAAS_DEPLOYMENT_MODE() { return state.mode; } } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from(table: string) {
    state.tables.push(table);
    if (table === "organization_subscriptions") return { select: () => ({ eq: () => ({ maybeSingle: async () => state.subscription }) }) };
    return { select: () => ({ eq: () => ({ is: async () => state.usage }) }) };
  },
}) }));

import { assertSaasCapacity, SaasCapacityError } from "./capacity";

describe("assertSaasCapacity", () => {
  beforeEach(() => {
    state.mode = "managed_saas";
    state.subscription = { data: { status: "active", limits: { members: 2 } }, error: null };
    state.usage = { count: 2, error: null };
    state.tables = [];
  });
  it("self-host não consulta billing", async () => {
    state.mode = "self_hosted";
    await expect(assertSaasCapacity("org", "members")).resolves.toBeUndefined();
    expect(state.tables).toEqual([]);
  });
  it("bloqueia criação futura no limite explícito", async () => {
    await expect(assertSaasCapacity("org", "members")).rejects.toMatchObject({ code: "plan_limit_reached", resource: "members", limit: 2 });
  });
  it("assinatura ausente falha aberto e permanece visível no console", async () => {
    state.subscription = { data: null, error: null };
    await expect(assertSaasCapacity("org", "members")).resolves.toBeUndefined();
    expect(state.tables).toEqual(["organization_subscriptions"]);
  });
  it("erro de leitura não finge capacidade", async () => {
    state.subscription = { data: null, error: { message: "schema missing" } };
    await expect(assertSaasCapacity("org", "members")).rejects.toBeInstanceOf(SaasCapacityError);
  });
});
