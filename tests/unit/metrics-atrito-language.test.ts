import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
const { requireRole, rpc, orgQuery } = vi.hoisted(() => ({
  requireRole: vi.fn(), rpc: vi.fn(),
  orgQuery: { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() },
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => orgQuery }) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: vi.fn() }));
import { GET } from "@/app/api/v1/metrics/atrito/route";

describe("idioma resolvido das métricas", () => {
  it.each([["pt-BR", "Conversão"], ["es", "Conversión"], ["en", "Conversion"]])(
    "usa %s da organização quando não há preferência pessoal", async (idioma, titulo) => {
      requireRole.mockResolvedValue({ ok: true, org: { orgId: "fixture-org" }, user: { locale: null, idioma } });
      orgQuery.select.mockReturnValue(orgQuery);
      orgQuery.eq.mockReturnValue(orgQuery);
      orgQuery.maybeSingle.mockResolvedValue({ data: { settings: {} } });
      rpc.mockResolvedValue({ data: null, error: null });
      const response = await GET(new NextRequest("http://localhost/api/v1/metrics/atrito"));
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.data.pares[0].titulo).toBe(titulo);
      expect(rpc).toHaveBeenLastCalledWith("fn_atrito_metrics", expect.objectContaining({ p_org: "fixture-org" }));
    },
  );
});
