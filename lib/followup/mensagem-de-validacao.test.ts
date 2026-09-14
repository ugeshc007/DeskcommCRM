import { describe, expect, it, vi } from "vitest";

import { mensagemDeErroDePublicacao } from "./mensagem-de-validacao";

describe("mensagemDeErroDePublicacao", () => {
  it("troca o detalhe interno da janela de 24h por uma ação legível", () => {
    const t = vi.fn((texto: string) => `translated:${texto}`);

    const mensagem = mensagemDeErroDePublicacao(
      {
        node_id: "ultima",
        code: "long_wait_needs_template",
        message: 'Nó "ultima" acumula ≥24h de espera e precisa de fallback_template_id.',
      },
      t,
    );

    expect(mensagem).toContain("translated:Esta mensagem está agendada para depois de 24 horas");
    expect(mensagem).not.toContain("fallback_template_id");
  });
});
