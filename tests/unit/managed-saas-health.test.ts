import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ workerUrl: "" }));

vi.mock("@/lib/env", () => ({
  env: {
    SAAS_DEPLOYMENT_MODE: "managed_saas",
    SAAS_BILLING_WEBHOOK_SECRET: "s".repeat(32),
    get MANAGED_WORKER_HEALTH_URL() { return state.workerUrl; },
    NEXT_PUBLIC_SUPABASE_URL: "https://database.example.test",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
    UPSTASH_REDIS_REST_URL: "",
    UPSTASH_REDIS_REST_TOKEN: "",
    WAHA_API_BASE_URL: "",
    WAHA_API_KEY: "",
    INTERNAL_CRON_SECRET: "",
    INTERNAL_SECRET: "",
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => table === "organization_subscriptions"
      ? { select: () => ({ limit: async () => ({ data: [], error: null }) }) }
      : {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { agent_last_seen_at: new Date().toISOString() }, error: null }) }),
          }),
        },
  }),
}));

function request() {
  return new NextRequest("https://app.example.test/api/v1/health");
}

describe("managed SaaS worker readiness", () => {
  beforeEach(() => {
    vi.resetModules();
    state.workerUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("database.example.test")) return new Response("[]", { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    }));
  });

  it("reports the missing worker endpoint before onboarding tenants", async () => {
    const { GET } = await import("@/app/api/v1/health/route");
    const { data } = await (await GET(request())).json();
    expect(data.checks.managed_worker).toMatchObject({
      status: "degraded",
      reason: "nao_configurado",
      error: "erro_ao_consultar",
    });
  });

  it("checks the real worker health endpoint and requires its database to be ready", async () => {
    state.workerUrl = "http://worker.internal:8787/healthz";
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("database.example.test")) return new Response("[]", { status: 200 });
      if (url === state.workerUrl) return Response.json({ status: "ok", db: "ok", uptime_s: 42 });
      throw new Error(`unexpected fetch: ${url}`);
    }));
    const { GET } = await import("@/app/api/v1/health/route");
    const { data } = await (await GET(request())).json();
    expect(data.checks.managed_worker).toEqual({ status: "ok", latency_ms: expect.any(Number) });
    expect(JSON.stringify(data)).not.toContain("worker.internal");
  });
});
