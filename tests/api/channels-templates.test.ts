import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupportWrite: vi.fn(),
  requireRole: vi.fn(),
  metaSessionForOrg: vi.fn(),
  resolveMetaCreds: vi.fn(),
  syncTemplates: vi.fn(),
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/impersonate/support", () => ({
  requireSupportWrite: mocks.requireSupportWrite,
}));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: mocks.requireRole }));
vi.mock("@/lib/channels/meta/session", () => ({
  metaSessionForOrg: mocks.metaSessionForOrg,
}));
vi.mock("@/lib/channels/meta/credentials", () => ({
  resolveMetaCreds: mocks.resolveMetaCreds,
}));
vi.mock("@/lib/channels/meta/template-sync", () => ({ syncTemplates: mocks.syncTemplates }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));

import { POST } from "@/app/api/v1/channels/templates/route";

describe("POST /api/v1/channels/templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupportWrite.mockResolvedValue(null);
    mocks.requireRole.mockResolvedValue({ ok: true, org: { orgId: "org-1" } });
    mocks.metaSessionForOrg.mockResolvedValue({
      id: "session-1",
      organizationId: "org-1",
      wabaId: "waba-1",
      phoneNumberId: "phone-1",
    });
    mocks.createAdminClient.mockReturnValue({ client: "admin" });
    mocks.resolveMetaCreds.mockResolvedValue({
      phoneNumberId: "phone-1",
      token: "stored-channel-token",
      graphVersion: "v26.0",
      source: "session",
    });
    mocks.syncTemplates.mockResolvedValue({ inserted: 1, updated: 0, unchanged: 0, disabled: 0 });
  });

  it("sincroniza com a credencial cifrada da sessão, sem depender do token global", async () => {
    const response = await POST(new Request("https://example.test/api/v1/channels/templates", {
      method: "POST",
    }) as never);

    expect(response.status).toBe(200);
    expect(mocks.resolveMetaCreds).toHaveBeenCalledWith(
      { client: "admin" },
      { organizationId: "org-1", phoneNumberId: "phone-1" },
    );
    expect(mocks.syncTemplates).toHaveBeenCalledWith({
      organizationId: "org-1",
      wabaId: "waba-1",
      token: "stored-channel-token",
      graphVersion: "v26.0",
    });
  });
});
