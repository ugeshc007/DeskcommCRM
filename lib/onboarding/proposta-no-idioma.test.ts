import { describe, expect, it } from "vitest";

import { traduzir } from "@/lib/i18n/dicionario";
import { PACOTE_PADRAO } from "@/lib/onboarding/pacotes-de-funil";
import { propostaNoIdioma } from "@/lib/onboarding/proposta-no-idioma";

describe("propostaNoIdioma", () => {
  it("entrega o quadro padrão inteiro em inglês sem alterar o catálogo", () => {
    const original = structuredClone(PACOTE_PADRAO.proposta);

    const proposta = propostaNoIdioma(PACOTE_PADRAO.proposta, (texto) =>
      traduzir(texto, "en"),
    );

    expect(proposta).toEqual({
      nome: "Customers",
      etapas: [
        { nome: "New contact", passo: "new" },
        { nome: "Already answered", passo: "contacted" },
        { nome: "Understanding the need", passo: "qualifying" },
        { nome: "Proposal sent", passo: "qualified" },
        { nome: "Negotiating", passo: "negotiating" },
        { nome: "Won", passo: "won" },
        { nome: "Lost", passo: "lost" },
      ],
    });
    expect(PACOTE_PADRAO.proposta).toEqual(original);
  });
});
