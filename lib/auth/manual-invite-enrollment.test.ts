import { beforeEach, describe, expect, it, vi } from "vitest";
import type { InvitePayload } from "./invite-token";
import { enrollFromManualInvite } from "./manual-invite-enrollment";

const createUser = vi.hoisted(() => vi.fn());
const signInWithPassword = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: inviteRow, error: null }),
      };
      return query;
    },
    auth: { admin: { createUser } },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }), signInWithPassword },
  }),
}));
vi.mock("@/lib/auth/aplicar-convite", () => ({ aplicarConvite: vi.fn() }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(), hashEmail: vi.fn() }));

const payload: InvitePayload = {
  invite_id: "11111111-1111-4111-8111-111111111111",
  organization_id: "22222222-2222-4222-8222-222222222222",
  email: "existing@example.test",
  role: "field_officer",
  exp: Math.floor(Date.now() / 1000) + 3600,
  interface_settings: { preset: "completa" },
};

const inviteRow = {
  organization_id: payload.organization_id,
  email: payload.email,
  role: payload.role,
  expires_at: new Date(payload.exp * 1000).toISOString(),
  accepted_at: null,
  revoked_at: null,
  email_dispatched: false,
  interface_settings: payload.interface_settings,
};

describe("manual staff invitation for an existing account", () => {
  beforeEach(() => {
    createUser.mockReset();
    signInWithPassword.mockReset();
  });

  it.each(["email_exists", "user_already_exists"])(
    "returns the existing-account next step for GoTrue code %s",
    async (code) => {
      createUser.mockResolvedValue({
        data: { user: null },
        error: { code, message: "Duplicate email" },
      });

      const result = await enrollFromManualInvite({
        payload,
        fullName: "Existing User",
        password: "example-password",
        requestId: null,
      });

      expect(result).toEqual({ kind: "already_exists" });
      expect(createUser).toHaveBeenCalledOnce();
      expect(signInWithPassword).not.toHaveBeenCalled();
    },
  );

  it("keeps unrelated provider failures distinct from an existing account", async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { code: "unexpected_failure", message: "Database unavailable" },
    });

    const result = await enrollFromManualInvite({
      payload,
      fullName: "Existing User",
      password: "example-password",
      requestId: null,
    });

    expect(result).toEqual({ kind: "failed" });
  });
});
