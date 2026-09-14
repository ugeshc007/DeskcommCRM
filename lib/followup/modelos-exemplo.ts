import type { TriggerConfig } from "./api-schemas";
import type { FlowGraph, FlowNode } from "./graph-schema";

/**
 * Exemplos educativos que viram RASCUNHOS editáveis. Não são publicados nem
 * inscritos automaticamente: cada organização precisa revisar texto, tempo e
 * gatilho antes de colocar o fluxo no ar.
 */
export const IDS_MODELO_FOLLOWUP = [
  "proposta-vendas",
  "lead-em-silencio",
  "carrinho-abandonado",
  "consulta-perdida",
] as const;

export type IdModeloFollowup = (typeof IDS_MODELO_FOLLOWUP)[number];

export interface ResumoModeloFollowup {
  id: IdModeloFollowup;
  nome: string;
  descricao: string;
  etapas: readonly string[];
}

export const MODELOS_FOLLOWUP: readonly ResumoModeloFollowup[] = [
  {
    id: "proposta-vendas",
    nome: "Acompanhamento de proposta comercial",
    descricao: "Para vendas consultivas ou serviços depois que uma proposta foi enviada.",
    etapas: [
      "Início manual",
      "Aguardar 3 dias",
      "Tirar dúvidas",
      "Aguardar mais 4 dias",
      "Encerrar com clareza",
    ],
  },
  {
    id: "lead-em-silencio",
    nome: "Reengajar lead em silêncio",
    descricao: "Para retomar uma conversa quando o contato não responde por 24 horas.",
    etapas: ["24 horas de silêncio", "Retomada educada", "Encerrar esta tentativa"],
  },
  {
    id: "carrinho-abandonado",
    nome: "Recuperação de carrinho abandonado",
    descricao: "Para lojas que recebem um evento de checkout ou pagamento pendente por webhook.",
    etapas: [
      "Evento por webhook",
      "Aguardar 2 horas",
      "Lembrar do pagamento",
      "Aguardar 22 horas",
      "Última ajuda",
    ],
  },
  {
    id: "consulta-perdida",
    nome: "Remarcar atendimento não realizado",
    descricao: "Para clínicas e serviços com agenda quando a pessoa não comparece.",
    etapas: [
      "Não comparecimento",
      "Aguardar 1 hora",
      "Oferecer remarcação",
      "Encerrar esta tentativa",
    ],
  },
] as const;

type Tradutor = (texto: string) => string;

function no(
  id: string,
  type: "trigger",
  label: string,
  x: number,
  config: Extract<FlowNode, { type: "trigger" }>["config"],
): Extract<FlowNode, { type: "trigger" }>;
function no(
  id: string,
  type: "wait",
  label: string,
  x: number,
  config: Extract<FlowNode, { type: "wait" }>["config"],
): Extract<FlowNode, { type: "wait" }>;
function no(
  id: string,
  type: "action",
  label: string,
  x: number,
  config: Extract<FlowNode, { type: "action" }>["config"],
): Extract<FlowNode, { type: "action" }>;
function no(
  id: string,
  type: "end",
  label: string,
  x: number,
  config: Extract<FlowNode, { type: "end" }>["config"],
): Extract<FlowNode, { type: "end" }>;
function no(
  id: string,
  type: "trigger" | "wait" | "action" | "end",
  label: string,
  x: number,
  config: Record<string, unknown>,
) {
  return { id, type, label, position: { x, y: 120 }, config } as FlowNode;
}

function aresta(id: string, source: string, target: string) {
  return { id, source, target, priority: 0, condition: { type: "always" as const } };
}

export function montarModeloFollowup(
  id: IdModeloFollowup,
  t: Tradutor,
): { graph: FlowGraph; triggerConfig: TriggerConfig } {
  if (id === "proposta-vendas") {
    return {
      triggerConfig: { kind: "manual", cancel_on_reply: true },
      graph: {
        nodes: [
          no("inicio", "trigger", t("Proposta enviada"), 0, {}),
          no("espera-3d", "wait", t("Aguardar 3 dias"), 260, {
            mode: "fixed",
            duration_ms: 259_200_000,
          }),
          no("duvidas", "action", t("Perguntar se há dúvidas"), 520, {
            mode: "ai_message",
            prompt_hint: t(
              "Retome a proposta com educação, ofereça ajuda e pergunte se existe alguma dúvida. Não invente preço, prazo ou condição.",
            ),
          }),
          no("espera-4d", "wait", t("Aguardar mais 4 dias"), 780, {
            mode: "fixed",
            duration_ms: 345_600_000,
          }),
          no("ultima", "action", t("Última tentativa educada"), 1040, {
            mode: "ai_message",
            prompt_hint: t(
              "Faça uma última tentativa breve e respeitosa. Deixe claro que a pessoa pode retomar a conversa quando quiser. Não pressione.",
            ),
          }),
          no("fim", "end", t("Tentativas concluídas"), 1300, {
            outcome: "exhausted",
            note: t("Modelo de exemplo: revise antes de publicar."),
          }),
        ],
        edges: [
          aresta("e1", "inicio", "espera-3d"),
          aresta("e2", "espera-3d", "duvidas"),
          aresta("e3", "duvidas", "espera-4d"),
          aresta("e4", "espera-4d", "ultima"),
          aresta("e5", "ultima", "fim"),
        ],
      },
    };
  }

  if (id === "lead-em-silencio") {
    return {
      triggerConfig: {
        kind: "silence",
        params: { threshold_minutes: 1_440 },
        cancel_on_reply: true,
      },
      graph: {
        nodes: [
          no("inicio", "trigger", t("Contato em silêncio por 24 horas"), 0, {}),
          no("retomar", "action", t("Retomar a conversa"), 300, {
            mode: "ai_message",
            prompt_hint: t(
              "Retome a conversa de forma breve e útil, usando apenas o contexto já confirmado. Faça uma pergunta simples e não pressione.",
            ),
          }),
          no("fim", "end", t("Tentativa concluída"), 600, {
            outcome: "custom",
            note: t("Aguardando uma nova resposta do contato."),
          }),
        ],
        edges: [aresta("e1", "inicio", "retomar"), aresta("e2", "retomar", "fim")],
      },
    };
  }

  if (id === "carrinho-abandonado") {
    return {
      triggerConfig: { kind: "webhook", cancel_on_reply: true },
      graph: {
        nodes: [
          no("inicio", "trigger", t("Checkout pendente recebido"), 0, {}),
          no("espera-2h", "wait", t("Aguardar 2 horas"), 250, {
            mode: "fixed",
            duration_ms: 7_200_000,
          }),
          no("lembrete", "action", t("Lembrar do pagamento"), 500, {
            mode: "ai_message",
            prompt_hint: t(
              "Lembre o contato de forma prestativa que o checkout ficou pendente e ofereça ajuda. Não invente disponibilidade, desconto ou link.",
            ),
          }),
          no("espera-22h", "wait", t("Aguardar mais 22 horas"), 750, {
            mode: "fixed",
            duration_ms: 79_200_000,
          }),
          no("ultima", "action", t("Oferecer ajuda uma última vez"), 1000, {
            mode: "ai_message",
            prompt_hint: t(
              "Ofereça ajuda uma última vez, de forma curta e sem pressão. Use somente dados confirmados da conversa.",
            ),
          }),
          no("fim", "end", t("Tentativas concluídas"), 1250, {
            outcome: "exhausted",
            note: t("Modelo de exemplo: revise antes de publicar."),
          }),
        ],
        edges: [
          aresta("e1", "inicio", "espera-2h"),
          aresta("e2", "espera-2h", "lembrete"),
          aresta("e3", "lembrete", "espera-22h"),
          aresta("e4", "espera-22h", "ultima"),
          aresta("e5", "ultima", "fim"),
        ],
      },
    };
  }

  return {
    triggerConfig: { kind: "appointment_no_show", cancel_on_reply: true },
    graph: {
      nodes: [
        no("inicio", "trigger", t("Atendimento não realizado"), 0, {}),
        no("espera-1h", "wait", t("Aguardar 1 hora"), 300, {
          mode: "fixed",
          duration_ms: 3_600_000,
        }),
        no("remarcar", "action", t("Oferecer remarcação"), 600, {
          mode: "ai_message",
          prompt_hint: t(
            "Pergunte com empatia se a pessoa deseja remarcar. Não confirme horário sem consultar a agenda e não atribua culpa.",
          ),
        }),
        no("fim", "end", t("Tentativa concluída"), 900, {
          outcome: "custom",
          note: t("Aguardando solicitação de remarcação."),
        }),
      ],
      edges: [
        aresta("e1", "inicio", "espera-1h"),
        aresta("e2", "espera-1h", "remarcar"),
        aresta("e3", "remarcar", "fim"),
      ],
    },
  };
}
