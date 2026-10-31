"use client";

import { useState } from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { actionConfigSchema } from "@/lib/followup/graph-schema";
import { MODOS_DA_ACAO, opcoes, type ModoDaAcao } from "@/lib/followup/vocabulario";
import { useMessageTemplates } from "@/hooks/inbox/useMessageTemplates";
import { useT } from "@/hooks/i18n/useT";

import type { ConfigOf } from "./shared";

/**
 * O seletor de modelo, no lugar dos dois `<Input>` que pediam um UUID colado à
 * mão. Trata os três estados em vez de fingir que a lista sempre chega:
 * carregando, vazia e erro — porque um seletor vazio sem explicação é o mesmo
 * beco sem saída que o campo de UUID era, só que mais bonito.
 */
function SeletorDeModelo({
  id,
  valor,
  onChange,
  permiteVazio,
}: {
  id: string;
  valor: string;
  onChange: (templateId: string) => void;
  permiteVazio: boolean;
}) {
  const t = useT();
  const { data: modelos, isLoading, isError } = useMessageTemplates();

  if (isLoading) return <p className="text-xs text-text-muted">{t("Carregando seus modelos…")}</p>;
  if (isError) {
    return (
      <p className="text-xs text-error-fg">
        {t("Não consegui carregar seus modelos de mensagem. Recarregue a página.")}
      </p>
    );
  }
  if (!modelos?.length) {
    return (
      <p className="text-xs text-text-muted">
        {t(
          "Você ainda não tem modelos de mensagem. Crie um em Ajustes → Modelos e ele aparece aqui.",
        )}
      </p>
    );
  }

  const SEM_MODELO = "__nenhum__";
  return (
    <Select
      value={valor === "" ? SEM_MODELO : valor}
      onValueChange={(v) => onChange(v === SEM_MODELO ? "" : v)}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={t("Escolha um modelo")} />
      </SelectTrigger>
      <SelectContent>
        {permiteVazio && <SelectItem value={SEM_MODELO}>{t("Nenhum")}</SelectItem>}
        {modelos.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.title}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ActionForm({
  config,
  onChange,
}: {
  config: ConfigOf<"action">;
  onChange: (c: ConfigOf<"action">) => void;
}) {
  const t = useT();
  const [mode, setMode] = useState(config.mode);
  const [body, setBody] = useState(config.mode === "text" ? config.body : "");
  const [promptHint, setPromptHint] = useState(
    config.mode === "ai_message" ? config.prompt_hint : "",
  );
  const [fallbackTemplateId, setFallbackTemplateId] = useState(
    config.mode === "ai_message" ? (config.fallback_template_id ?? "") : "",
  );
  const [templateId, setTemplateId] = useState(
    config.mode === "template" ? config.template_id : "",
  );
  const [error, setError] = useState<string | null>(null);

  const commit = (next: {
    mode: ModoDaAcao;
    body: string;
    promptHint: string;
    fallbackTemplateId: string;
    templateId: string;
  }) => {
    const candidate =
      next.mode === "text"
        ? { mode: "text" as const, body: next.body }
        : next.mode === "ai_message"
          ? {
              mode: "ai_message" as const,
              prompt_hint: next.promptHint,
              ...(next.fallbackTemplateId.trim()
                ? { fallback_template_id: next.fallbackTemplateId }
                : {}),
            }
          : { mode: "template" as const, template_id: next.templateId };
    const parsed = actionConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? t("Configuração inválida."));
      return;
    }
    setError(null);
    onChange(parsed.data);
  };

  const fields = { body, promptHint, fallbackTemplateId, templateId };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="action-mode">{t("Como escrever a mensagem")}</Label>
        <Select
          value={mode}
          onValueChange={(v) => {
            const next = v as ModoDaAcao;
            setMode(next);
            commit({ mode: next, ...fields });
          }}
        >
          <SelectTrigger id="action-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {opcoes(MODOS_DA_ACAO).filter(({ valor }) => valor !== "media" && valor !== 'interactive' && valor !== 'set_variable').map(({ valor, rotulo }) => (
              <SelectItem key={valor} value={valor}>
                {t(rotulo)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {mode === "text" ? (
        <div className="space-y-2">
          <Label htmlFor="action-body">{t("Texto enviado ao contato")}</Label>
          <Textarea
            id="action-body"
            maxLength={4000}
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              commit({ mode, ...fields, body: e.target.value });
            }}
          />
          <p className="text-xs text-text-muted">
            {t("Sent exactly as written, without AI. In a loop, {{volta}} is the current repetition and {{voltas}} is the total.")}
          </p>
          <p className="text-xs text-text-muted">
            {'Use {{session.name}} to insert a value collected into the name session variable. Missing values stop the step; file references cannot be sent as text.'}
          </p>
        </div>
      ) : mode === "ai_message" ? (
        <>
          <div className="space-y-2">
            <Label htmlFor="action-prompt-hint">{t("Instrução para a IA")}</Label>
            <Textarea
              id="action-prompt-hint"
              maxLength={1000}
              value={promptHint}
              onChange={(e) => {
                setPromptHint(e.target.value);
                commit({ mode, ...fields, promptHint: e.target.value });
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="action-fallback">
              {t("Se a IA não conseguir escrever, mandar este modelo")}
            </Label>
            <SeletorDeModelo
              id="action-fallback"
              valor={fallbackTemplateId}
              permiteVazio
              onChange={(v) => {
                setFallbackTemplateId(v);
                commit({ mode, ...fields, fallbackTemplateId: v });
              }}
            />
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="action-template-id">{t("Modelo de mensagem")}</Label>
          <SeletorDeModelo
            id="action-template-id"
            valor={templateId}
            permiteVazio={false}
            onChange={(v) => {
              setTemplateId(v);
              commit({ mode, ...fields, templateId: v });
            }}
          />
        </div>
      )}
      {error && <p className="text-xs text-error-fg">{error}</p>}
      <section
        className="overflow-hidden rounded-xl border border-border"
        aria-label="Message preview"
      >
        <div className="border-b border-border bg-surface px-3 py-2 text-xs font-semibold">
          {t("Customer message preview")}
        </div>
        <div className="bg-accent-soft p-4">
          {mode === "text" ? (
            <div className="ml-3 rounded-lg rounded-tr-none border border-border bg-surface p-3 text-sm break-words whitespace-pre-wrap shadow-sm">
              {body || t("Your message will appear here.")}
            </div>
          ) : (
            <p className="rounded-lg bg-surface p-3 text-xs text-text-muted">
              {t(
                mode === "ai_message"
                  ? "The agent generates this message at runtime using the conversation and your instructions. This preview does not call AI or send a message."
                  : "The selected saved template is sent at runtime. Choose a template above before saving.",
              )}
            </p>
          )}
        </div>
        <p className="p-3 text-xs text-text-muted">
          {t("Preview only — nothing is sent. Channel messaging-window rules still apply.")}
        </p>
      </section>
    </div>
  );
}
