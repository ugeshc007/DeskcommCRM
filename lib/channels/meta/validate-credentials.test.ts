import { afterEach, describe, expect, it, vi } from "vitest";

import { validateMetaCredentials } from "./validate-credentials";

const fetchOriginal = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  vi.restoreAllMocks();
});

describe("validateMetaCredentials", () => {
  it("valida o número pela lista do WABA e nunca consulta o objeto ambíguo diretamente", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: [{
        id: "phone-1",
        display_phone_number: "+971 50 123 4567",
        verified_name: "Store",
        quality_rating: "GREEN",
      }],
    }), { status: 200 }));
    globalThis.fetch = fetchMock;

    await expect(validateMetaCredentials({
      phoneNumberId: "phone-1",
      wabaId: "waba-1",
      token: "secret-token",
      graphVersion: "v22.0",
    })).resolves.toEqual({
      ok: true,
      displayPhoneNumber: "+971 50 123 4567",
      verifiedName: "Store",
      qualityRating: "GREEN",
    });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/v22.0/waba-1/phone_numbers?");
    expect(String(url)).not.toContain("secret-token");
    expect(init?.headers).toEqual({ Authorization: "Bearer secret-token" });
  });

  it("explica IDs trocados quando o número não pertence ao WABA", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: [{ id: "outro-phone" }],
    }), { status: 200 })) as typeof fetch;

    const result = await validateMetaCredentials({
      phoneNumberId: "app-id-colado-por-engano",
      wabaId: "waba-1",
      token: "secret-token",
    });

    expect(result).toEqual({
      ok: false,
      motivo:
        "O Phone Number ID não pertence ao WhatsApp Business Account informado. Copie os dois IDs em Meta → WhatsApp → API Setup; não use o App ID.",
      availablePhoneNumberIds: ["outro-phone"],
    });
  });

  it("distingue WABA sem número visível — normalmente permissão do usuário do sistema", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
    })) as typeof fetch;

    await expect(validateMetaCredentials({
      phoneNumberId: "phone-1",
      wabaId: "waba-1",
      token: "secret-token",
    })).resolves.toEqual({
      ok: false,
      motivo:
        "A Meta não devolveu nenhum número para este WhatsApp Business Account. Dê ao usuário do sistema acesso de controle total a essa conta e gere um novo token.",
      availablePhoneNumberIds: [],
    });
  });

  it("preserva o detalhe acionável devolvido pela Graph API", async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      error: { message: "OAuth error", error_data: { details: "Token expired" } },
    }), { status: 401 })) as typeof fetch;

    await expect(validateMetaCredentials({
      phoneNumberId: "phone-1",
      wabaId: "waba-1",
      token: "secret-token",
    })).resolves.toEqual({ ok: false, motivo: "Token expired" });
  });
});
