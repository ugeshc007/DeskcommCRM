import type { PropostaDeFunil } from "@/lib/onboarding/proposta-de-funil";

type Tradutor = (texto: string) => string;

/**
 * Traduz a cópia exibida do quadro sem alterar o catálogo canônico.
 *
 * Os nomes são campos editáveis e o onboarding grava exatamente o que está na
 * tela. Por isso a tradução precisa acontecer antes de o estado do formulário
 * nascer: quem escolheu English deve revisar e salvar um quadro em English.
 */
export function propostaNoIdioma(
  proposta: PropostaDeFunil,
  traduzir: Tradutor,
): PropostaDeFunil {
  return {
    nome: traduzir(proposta.nome),
    etapas: proposta.etapas.map((etapa) => ({
      ...etapa,
      nome: traduzir(etapa.nome),
    })),
  };
}
