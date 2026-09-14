"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useCreateFollowupFlow } from "@/hooks/followup/useFollowupFlows";
import { useT } from "@/hooks/i18n/useT";
import { FlowArrow } from "@/lib/ui/icons";
import { MODELOS_FOLLOWUP, type IdModeloFollowup } from "@/lib/followup/modelos-exemplo";

export function ExampleFlowTemplates() {
  const t = useT();
  const router = useRouter();
  const create = useCreateFollowupFlow();
  const [creatingId, setCreatingId] = useState<IdModeloFollowup | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const criar = (templateId: IdModeloFollowup, nome: string) => {
    setCreatingId(templateId);
    setErro(null);
    create.mutate(
      { name: t(nome), template_id: templateId },
      {
        onSuccess: (flow) => router.push(`/app/ai/followups/${flow.id}`),
        onError: (error: unknown) => {
          setCreatingId(null);
          setErro(
            error instanceof Error && error.message
              ? t(error.message)
              : t("Não consegui criar o exemplo. Tente de novo."),
          );
        },
      },
    );
  };

  return (
    <section aria-labelledby="modelos-followup" className="space-y-3">
      <div>
        <h2 id="modelos-followup" className="text-lg font-semibold">
          {t("Exemplos para começar")}
        </h2>
        <p className="text-sm text-text-muted">
          {t(
            "Cada exemplo cria um rascunho editável. Revise o gatilho, os tempos e as mensagens antes de publicar.",
          )}
        </p>
      </div>

      {erro && (
        <p
          role="alert"
          className="rounded-md border border-error-fg/30 bg-error-bg p-3 text-sm text-error-fg"
        >
          {erro}
        </p>
      )}

      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {MODELOS_FOLLOWUP.map((modelo) => (
          <li key={modelo.id}>
            <Card className="flex h-full flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <span className="rounded-md bg-accent-soft p-2 text-accent">
                  <FlowArrow size={18} aria-hidden />
                </span>
                <div className="min-w-0">
                  <h3 className="font-medium">{t(modelo.nome)}</h3>
                  <p className="mt-1 text-sm text-text-muted">{t(modelo.descricao)}</p>
                </div>
              </div>
              <ol className="flex flex-wrap gap-1.5" aria-label={t("Etapas incluídas")}>
                {modelo.etapas.map((etapa, index) => (
                  <li
                    key={etapa}
                    className="rounded-full border border-border px-2 py-1 text-xs text-text-muted"
                  >
                    {index + 1}. {t(etapa)}
                  </li>
                ))}
              </ol>
              <Button
                type="button"
                variant="outline"
                className="mt-auto self-start"
                disabled={create.isPending}
                onClick={() => criar(modelo.id, modelo.nome)}
              >
                {creatingId === modelo.id ? t("Criando rascunho…") : t("Usar este exemplo")}
              </Button>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
