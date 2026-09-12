import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runModelCall,
  SaasAiLimitExceededError,
} from "@/lib/agent-engine/edge/llm/run-model-call";

const ORG = "55555555-5555-4555-8555-555555555555";
const previousMode = process.env.SAAS_DEPLOYMENT_MODE;

afterEach(() => {
  if (previousMode === undefined) delete process.env.SAAS_DEPLOYMENT_MODE;
  else process.env.SAAS_DEPLOYMENT_MODE = previousMode;
});

describe("managed SaaS monthly AI limit at the model seam", () => {
  it("blocks before constructing the provider and leaves one actionable notice", async () => {
    process.env.SAAS_DEPLOYMENT_MODE = "managed_saas";
    const providerCalls: string[] = [];
    const inboxInserts: unknown[][] = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("left join ai_budgets")) {
        return { rows: [{ llm: { provider: "anthropic", default_model: "claude-test", params: {}, enabled_models: [] }, teto: null, modo: "off", efetivo_em: null, limiar_pct: null }] };
      }
      if (sql.includes("from ai_purpose_bindings")) return { rows: [] };
      if (sql.includes("from ai_provider_credentials")) return { rows: [] };
      if (sql.includes("from public.organization_subscriptions")) return { rows: [{ limite: "1000", gasto: "1000" }] };
      if (sql.includes("insert into public.agent_inbox_items")) {
        inboxInserts.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    });
    const registry = {
      anthropic: () => {
        providerCalls.push("anthropic");
        throw new Error("provider must not be constructed");
      },
    };

    await expect(runModelCall(
      { query } as never,
      { anthropicApiKey: "test-key" },
      { tenantId: ORG, messages: [{ role: "user", content: "hello" }] },
      { registry: registry as never },
    )).rejects.toMatchObject({ name: "llm_budget_exceeded", limit: 1000, terminal: true });

    expect(providerCalls).toEqual([]);
    expect(inboxInserts).toEqual([[ORG]]);
    expect(query.mock.calls.filter(([sql]) => String(sql).includes("insert into public.agent_inbox_items"))).toHaveLength(1);
    expect(new SaasAiLimitExceededError(1000).message).toContain("before contacting the provider");
  });

  it("keeps self-hosted installations outside the commercial gate", async () => {
    process.env.SAAS_DEPLOYMENT_MODE = "self_hosted";
    const sqls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      sqls.push(sql);
      if (sql.includes("left join ai_budgets")) return { rows: [{ llm: { provider: "anthropic", default_model: "claude-test", params: {}, enabled_models: [] }, teto: null, modo: "off", efetivo_em: null, limiar_pct: null }] };
      if (sql.includes("from ai_purpose_bindings") || sql.includes("from ai_provider_credentials")) return { rows: [] };
      if (sql.includes("insert into llm_calls")) return { rows: [{ id: "call-1" }] };
      return { rows: [] };
    });
    const model = {
      specificationVersion: "v3",
      provider: "anthropic",
      modelId: "claude-test",
      doGenerate: async () => ({
        content: [{ type: "text", text: "ok" }],
        finishReason: { unified: "stop", raw: undefined },
        usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
        warnings: [],
      }),
    };

    await runModelCall(
      { query } as never,
      { anthropicApiKey: "test-key" },
      { tenantId: ORG, messages: [{ role: "user", content: "hello" }] },
      { registry: { anthropic: () => model as never } as never },
    );

    expect(sqls.some((sql) => sql.includes("from public.organization_subscriptions"))).toBe(false);
  });
});
