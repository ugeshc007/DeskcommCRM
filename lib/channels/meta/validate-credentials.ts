/**
 * Valida uma credencial do canal oficial ANTES de gravá-la.
 *
 * Mora aqui por duas razões que se somam: a catraca (`scripts/lint-channels.ts`)
 * proíbe nome de provider fora de `lib/channels/` — ela me pegou com a chamada à
 * Graph API dentro da rota — e a rota não deve saber com quem fala. Ela pergunta
 * "essa credencial presta?"; quem sabe como responder é o canal.
 *
 * Gravar primeiro e descobrir depois é o que faz o operador achar que conectou e só
 * entender que não na primeira mensagem que não sai, com o lead esperando do outro
 * lado. Esta é a mesma chamada que provou o ambiente na Fase 3b.
 */
export type ValidacaoCredencial =
  | { ok: true; displayPhoneNumber: string | null; verifiedName: string | null; qualityRating: string | null }
  | { ok: false; motivo: string; availablePhoneNumberIds?: string[] };

export async function validateMetaCredentials(input: {
  phoneNumberId: string;
  wabaId: string;
  token: string;
  graphVersion?: string;
}): Promise<ValidacaoCredencial> {
  const version = input.graphVersion ?? process.env.META_GRAPH_VERSION ?? "v22.0";
  try {
    // O número é validado PELO WABA que o possui. Consultar `/{id}` diretamente
    // pressupõe que o valor recebido já seja um WhatsAppBusinessPhoneNumber; se
    // o operador colar o App ID ou o próprio WABA, a Graph responde o opaco
    // "nonexisting field (display_phone_number)". A aresta abaixo resolve os
    // dois problemas: prova a associação WABA↔número e devolve os campos do tipo
    // correto, sem pôr o bearer na query string.
    const query = new URLSearchParams({
      fields: "id,display_phone_number,verified_name,quality_rating",
      limit: "100",
    });
    const res = await fetch(
      `https://graph.facebook.com/${version}/${encodeURIComponent(input.wabaId)}/phone_numbers?${query}`,
      { headers: { Authorization: `Bearer ${input.token}` } },
    );
    const body = (await res.json().catch(() => ({}))) as {
      data?: Array<{
        id?: string;
        display_phone_number?: string;
        verified_name?: string;
        quality_rating?: string;
      }>;
      error?: { message?: string; error_data?: { details?: string } };
    };

    if (!res.ok || body.error) {
      return {
        ok: false,
        // O `details` é o que distingue token vencido de número errado de permissão
        // faltando. Sem ele o operador só sabe que "não deu".
        motivo: body.error?.error_data?.details ?? body.error?.message ?? `http_${res.status}`,
      };
    }

    const numero = body.data?.find((item) => item.id === input.phoneNumberId);
    if (!numero) {
      const idsDisponiveis = (body.data ?? [])
        .map((item) => item.id)
        .filter((id): id is string => Boolean(id));
      return {
        ok: false,
        motivo: idsDisponiveis.length === 0
          ? "A Meta não devolveu nenhum número para este WhatsApp Business Account. Dê ao usuário do sistema acesso de controle total a essa conta e gere um novo token."
          : "O Phone Number ID não pertence ao WhatsApp Business Account informado. Copie os dois IDs em Meta → WhatsApp → API Setup; não use o App ID.",
        availablePhoneNumberIds: idsDisponiveis,
      };
    }

    return {
      ok: true,
      displayPhoneNumber: numero.display_phone_number ?? null,
      verifiedName: numero.verified_name ?? null,
      qualityRating: numero.quality_rating ?? null,
    };
  } catch (err) {
    // Rede caída não é credencial ruim — o motivo precisa dizer isso, senão o
    // operador troca um token que estava certo.
    return { ok: false, motivo: `rede indisponível: ${err instanceof Error ? err.message : "erro"}` };
  }
}
