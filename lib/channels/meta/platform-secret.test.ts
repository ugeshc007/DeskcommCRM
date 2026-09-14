import { beforeEach, describe, expect, it, vi } from "vitest";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptWebhookSecret } from "@/lib/webhooks/secrets";

vi.mock("@/lib/env", () => ({ env: { META_APP_SECRET: "env-secret" } }));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn() } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/webhooks/secrets", () => ({ decryptWebhookSecret: vi.fn() }));

function db(data: unknown, error: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  vi.mocked(createAdminClient).mockReturnValue({ from: vi.fn(() => query) } as never);
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { invalidateMetaAppSecret } = await import("./platform-secret");
  invalidateMetaAppSecret();
});
describe("resolução do App Secret da instalação", () => {
  it("prefere o segredo cifrado salvo pela tela", async () => {
    db({ app_secret_encrypted: "cipher" });
    vi.mocked(decryptWebhookSecret).mockResolvedValue("database-secret");
    const { resolveMetaAppSecret, metaAppSecretState } = await import("./platform-secret");

    expect(await resolveMetaAppSecret()).toEqual({ value: "database-secret", source: "database" });
    expect(await metaAppSecretState()).toEqual({ configured: true, source: "database" });
  });

  it("usa o ambiente como piso quando a tabela ainda não existe", async () => {
    db(null, { code: "42P01" });
    const { resolveMetaAppSecret } = await import("./platform-secret");
    expect(await resolveMetaAppSecret()).toEqual({ value: "env-secret", source: "environment" });
  });
});
