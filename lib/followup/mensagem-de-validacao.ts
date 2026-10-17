import type { PublishValidationError } from "./validate-publish";

type Tradutor = (texto: string) => string;

/**
 * A API devolve mensagens diagnósticas em PT-BR para logs e integrações, mas o
 * construtor precisa explicar a correção no idioma da pessoa. Usar o código
 * estável também evita mostrar nomes internos como `fallback_template_id`.
 */
const MENSAGEM_POR_CODIGO: Record<PublishValidationError["code"], string> = {
  choice_source_invalid: 'Reconnect the reply block to its matching buttons/list message.',
  media_missing: "Upload a file before publishing this media block.",
  integration_connection_missing: 'Select a tested organization connection before publishing.',
  integration_branch_missing: 'Connect both Success and Error outputs.',
  no_trigger: "Adicione um gatilho de início ao fluxo.",
  multiple_triggers: "Mantenha apenas um gatilho de início no fluxo.",
  unreachable_node: "Conecte este nó ao caminho que começa no gatilho.",
  no_end_path: "Conecte este nó a um caminho que termine em um nó de fim.",
  missing_class_edge: "Conecte todas as classificações deste nó a uma próxima etapa.",
  missing_branch_edge: "Conecte todas as saídas deste nó a uma próxima etapa.",
  missing_no_reply_edge: "Adicione e conecte a saída para quando não houver resposta.",
  missing_always_fallback: "Adicione uma saída de escape para que nenhum contato fique parado.",
  grace_too_short: "Defina um tempo de espera de pelo menos 15 minutos.",
  long_wait_needs_template:
    "Esta mensagem está agendada para depois de 24 horas. Selecione um modelo aprovado do WhatsApp neste nó antes de publicar.",
  cycle_without_wait: "Adicione uma espera de pelo menos 5 minutos dentro deste ciclo.",
  max_steps_exceeded: "Reduza o fluxo para no máximo 30 etapas a partir do gatilho.",
};

export function mensagemDeErroDePublicacao(
  erro: PublishValidationError,
  t: Tradutor,
): string {
  return t(MENSAGEM_POR_CODIGO[erro.code]);
}
