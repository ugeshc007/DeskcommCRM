import { beforeEach, describe, expect, it, vi } from "vitest";

import { audit } from "@/lib/audit";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/lib/supabase/admin";
import { encryptWebhookSecret } from "@/lib/webhooks/secrets";
import { updateMetaWebhookSecret } from "./updateMetaWebhookSecret";

vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/lib/channels/meta/platform-secret", () => ({ invalidateMetaAppSecret: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/webhooks/secrets", () => ({ encryptWebhookSecret: vi.fn() }));

const upsert = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePlatformAdmin).mockResolvedValue({
    user: { id: "11111111-1111-4111-8111-111111111111" },
    platformAdmin: { user_id: "11111111-1111-4111-8111-111111111111", scope: "full", mfa_required: false },
  } as never);
  vi.mocked(encryptWebhookSecret).mockResolvedValue("encrypted" as never);
  upsert.mockResolvedValue({ error: null });
  vi.mocked(createAdminClient).mockReturnValue({
    from: vi.fn(() => ({ upsert })),
  } as never);
});

describe("salvar App Secret da instalação", () => {
  it("autoriza novamente no servidor, cifra e não audita o valor", async () => {
    const secret = "meta-app-secret-never-log-this";
    expect(await updateMetaWebhookSecret({ app_secret: secret })).toEqual({ ok: true });

    expect(requirePlatformAdmin).toHaveBeenCalledOnce();
    expect(encryptWebhookSecret).toHaveBeenCalledWith(expect.anything(), secret);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, app_secret_encrypted: "encrypted" }),
      { onConflict: "id" },
    );
    expect(JSON.stringify(vi.mocked(audit).mock.calls)).not.toContain(secret);
  });

  it("input inválido não toca cifra nem banco", async () => {
    expect(await updateMetaWebhookSecret({ app_secret: "short" })).toEqual({
      ok: false,
      error: "Digite um App Secret da Meta válido.",
    });
    expect(encryptWebhookSecret).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });
});
