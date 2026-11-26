"use client";

import { useT } from "@/hooks/i18n/useT";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { matchReplyConfigSchema, type IfExists, type MatchReplyBranch, type ReplySaveTo } from "@/lib/followup/graph-schema";
import { answerFormatSchema, type AnswerFormat } from "@/lib/followup/answer-validation";
import { ESPERA_PELA_RESPOSTA, SE_INFORMACAO_JA_EXISTIR, FORMATOS_DE_RESPOSTA, opcoes } from "@/lib/followup/vocabulario";
import { camposDoFunil } from "@/lib/leads/campos-do-funil";
import { Plus, Trash } from "@/lib/ui/icons";
import { usePipelines } from "@/hooks/webhooks/useWebhookSources";

import { msToMin, minToMs, type ConfigOf } from "./shared";

function novoId(usados: ReadonlySet<string>): string {
  for (let n = 1; ; n++) {
    const candidato = `br_${n}`;
    if (!usados.has(candidato)) return candidato;
  }
}

export function MatchReplyForm({
  config,
  onChange,
}: {
  config: ConfigOf<"match_reply">;
  onChange: (c: ConfigOf<"match_reply">) => void;
}) {
  const t = useT();
  const [branches, setBranches] = useState(config.branches);
  const [graceMin, setGraceMin] = useState(msToMin(config.grace_timeout_ms));
  const [saveTo, setSaveTo] = useState<ReplySaveTo | undefined>(config.save_to);
  const [ifExists, setIfExists] = useState<IfExists>(config.if_exists ?? "overwrite");
  const [answerFormat, setAnswerFormat] = useState<AnswerFormat | "none">(config.answer_format ?? "none");
  const [error, setError] = useState<string | null>(null);
  const pipelines = usePipelines();
  const campos = (pipelines.data?.data ?? []).flatMap((p) => camposDoFunil(p.settings));
  const camposUnicos = [...new Map(campos.map((c) => [c.key, c])).values()];

  const commit = (next: {
    branches: MatchReplyBranch[];
    graceMin: number;
    saveTo?: ReplySaveTo;
    ifExists: IfExists;
    answerFormat?: AnswerFormat | "none";
  }) => {
    const candidate = {
      branches: next.branches,
      grace_timeout_ms: minToMs(next.graceMin),
      ...(next.saveTo ? { save_to: next.saveTo, if_exists: next.ifExists } : {}),
      ...((next.answerFormat ?? answerFormat) !== "none"
        ? { answer_format: next.answerFormat ?? answerFormat } : {}),
    };
    const parsed = matchReplyConfigSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Configuração inválida.");
      return;
    }
    setError(null);
    onChange(parsed.data);
  };

  const atualizar = (index: number, patch: Partial<MatchReplyBranch>) => {
    const next = branches.map((b, i) => (i === index ? { ...b, ...patch } : b));
    setBranches(next);
    commit({ branches: next, graceMin, saveTo, ifExists });
  };

  if (config.choice_source_node_id) return <div className="space-y-3">
    <p className="text-sm">{t('Choices come from the connected message. Edit labels and options there; connections use stable IDs.')}</p>
    {config.branches.map(branch => <div key={branch.id} className="rounded-md border border-border p-2 text-sm">{branch.label}</div>)}
    <Label htmlFor="choice-timeout">{t('Reply timeout (minutes)')}</Label>
    <Input id="choice-timeout" type="number" min={15} value={graceMin} onChange={e => {
      const minutes = Number(e.target.value); setGraceMin(minutes);
      const parsed = matchReplyConfigSchema.safeParse({ ...config, grace_timeout_ms: minToMs(minutes) });
      if (parsed.success) { setError(null); onChange(parsed.data); } else setError('Reply timeout must be at least 15 minutes.');
    }} />
    <p className="text-xs text-text-muted">{t('Connect every choice, the fallback for invalid or old selections, and the No reply timeout.')}</p>
    {error && <p role="alert" className="text-xs text-error-fg">{error}</p>}
  </div>;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="answer-format">{t("Answer format")}</Label>
        <Select value={answerFormat} onValueChange={(value) => {
          const format = value === "none" ? "none" : answerFormatSchema.parse(value);
          const nextBranches = format === "none" && !branches.length
            ? [{ id: "br_ok", label: "OK", op: "contains" as const, pattern: "ok" }] : branches;
          setBranches(nextBranches);
          setAnswerFormat(format);
          commit({ branches: nextBranches, graceMin, saveTo, ifExists, answerFormat: format });
        }}>
          <SelectTrigger id="answer-format" aria-describedby="answer-format-help"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("No validation (existing behavior)")}</SelectItem>
            {opcoes(FORMATOS_DE_RESPOSTA).map(({ valor, rotulo }) => <SelectItem key={valor} value={valor}>{t(rotulo)}</SelectItem>)}
          </SelectContent>
        </Select>
        <p id="answer-format-help" className="text-xs text-text-muted">
          {t("Send the question using a text block before this block. Invalid answers are not saved. Connect Invalid answer to a correction message or human help, and connect No reply for timeouts.")}
        </p>
        {answerFormat === 'file' && <p className="text-xs text-text-muted">{t('Files stay in the conversation. Saving an answer stores an attachment reference, not file contents or a public download link. This does not scan files for malware.')}</p>}
      </div>
      <div className="space-y-2">
        <Label>{t("Regras de texto")}</Label>
        {branches.map((branch, index) => (
          <div key={branch.id} className="space-y-2 rounded-md border border-border p-2">
            <Input
              aria-label={`${t("Rótulo da regra")} ${index + 1}`}
              value={branch.label}
              onChange={(e) => atualizar(index, { label: e.target.value })}
              placeholder={t("Rótulo")}
            />
            <div className="flex gap-2">
              <Select
                value={branch.op}
                onValueChange={(v) => atualizar(index, { op: v as MatchReplyBranch["op"] })}
              >
                <SelectTrigger aria-label={`${t("Comparação da regra")} ${index + 1}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contains">{t("Contém")}</SelectItem>
                  <SelectItem value="eq">{t("É igual a")}</SelectItem>
                </SelectContent>
              </Select>
              <Input
                aria-label={`${t("Texto da regra")} ${index + 1}`}
                value={branch.pattern}
                onChange={(e) => atualizar(index, { pattern: e.target.value })}
                placeholder={t("texto a casar")}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`${t("Remover regra")} ${index + 1}`}
                disabled={branches.length <= 1}
                onClick={() => {
                  const next = branches.filter((_, i) => i !== index);
                  setBranches(next);
                  commit({ branches: next, graceMin, saveTo, ifExists });
                }}
              >
                <Trash size={14} aria-hidden />
              </Button>
            </div>
          </div>
        ))}
        {branches.length < 8 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              const usados = new Set(branches.map((b) => b.id));
              const next = [
                ...branches,
                { id: novoId(usados), label: "Nova regra", op: "contains" as const, pattern: "ok" },
              ];
              setBranches(next);
              commit({ branches: next, graceMin, saveTo, ifExists });
            }}
          >
            <Plus size={14} aria-hidden className="mr-1" /> {t("Adicionar regra")}
          </Button>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="match-reply-grace">{t(ESPERA_PELA_RESPOSTA.rotulo)}</Label>
        <Input
          id="match-reply-grace"
          type="number"
          min={ESPERA_PELA_RESPOSTA.minimoMinutos}
          value={graceMin}
          onChange={(e) => {
            const v = Number(e.target.value);
            setGraceMin(v);
            commit({ branches, graceMin: v, saveTo, ifExists });
          }}
        />
        <p className="text-xs text-text-muted">{t("If the customer does not reply in time, follow the No reply path. Minimum: 15 minutes.")}</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="match-reply-save">{t("Gravar a resposta em")}</Label>
        <Select
          value={
            saveTo?.kind === 'session_variable' ? '__session__' : saveTo?.kind === "contact_name"
              ? "__contact_name__"
              : saveTo?.kind === "lead_custom"
                ? camposUnicos.some((c) => c.key === saveTo.key)
                  ? saveTo.key
                  : "__livre__"
                : "__none__"
          }
          onValueChange={(v) => {
            let next: ReplySaveTo | undefined;
            if (v === "__none__") next = undefined;
            else if (v === '__session__') next = { kind: 'session_variable', key: 'answer' };
            else if (v === "__contact_name__") next = { kind: "contact_name" };
            else if (v === "__livre__") next = { kind: "lead_custom", key: "campo_{{volta}}" };
            else next = { kind: "lead_custom", key: v };
            setSaveTo(next);
            if (next?.kind === 'session_variable') {
              setIfExists('overwrite');
              if (answerFormat === 'none') setAnswerFormat('text');
              commit({ branches, graceMin, saveTo: next, ifExists: 'overwrite', answerFormat: answerFormat === 'none' ? 'text' : answerFormat });
            } else commit({ branches, graceMin, saveTo: next, ifExists });
          }}
        >
          <SelectTrigger id="match-reply-save">
            <SelectValue placeholder={t("Não gravar")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{t("Não gravar")}</SelectItem>
            <SelectItem value="__session__">{t('Session variable (this enrollment only)')}</SelectItem>
            <SelectItem value="__contact_name__">{t("Nome do contato")}</SelectItem>
            {camposUnicos.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.label} ({c.key})
              </SelectItem>
            ))}
            <SelectItem value="__livre__">{t("Chave livre (use")} {t("{{volta}}")} {t("no laço)")}</SelectItem>
          </SelectContent>
        </Select>
        {saveTo?.kind === 'session_variable' && <Input aria-label={t('Variable name')} value={saveTo.key} maxLength={60} onChange={e => {
          const next: ReplySaveTo = { kind: 'session_variable', key: e.target.value };
          setSaveTo(next); commit({ branches, graceMin, saveTo: next, ifExists: 'overwrite' });
        }} />}
        {saveTo?.kind === "lead_custom" && !camposUnicos.some((c) => c.key === saveTo.key) && (
          <Input
            aria-label={t("Chave do campo personalizado")}
            value={saveTo.key}
            onChange={(e) => {
              const next: ReplySaveTo = { kind: "lead_custom", key: e.target.value };
              setSaveTo(next);
              commit({ branches, graceMin, saveTo: next, ifExists });
            }}
          />
        )}
        {saveTo && saveTo.kind !== 'session_variable' && (
          <div className="space-y-2">
            <Label htmlFor="match-reply-if-exists">{t(SE_INFORMACAO_JA_EXISTIR.rotulo)}</Label>
            <Select
              value={ifExists}
              onValueChange={(v) => {
                const next = v as IfExists;
                setIfExists(next);
                commit({ branches, graceMin, saveTo, ifExists: next });
              }}
            >
              <SelectTrigger id="match-reply-if-exists">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">{t(SE_INFORMACAO_JA_EXISTIR.skip)}</SelectItem>
                <SelectItem value="overwrite">{t(SE_INFORMACAO_JA_EXISTIR.overwrite)}</SelectItem>
                <SelectItem value="confirm">{t(SE_INFORMACAO_JA_EXISTIR.confirm)}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-text-muted">{t(SE_INFORMACAO_JA_EXISTIR.ajuda)}</p>
          </div>
        )}
        <p className="text-xs text-text-muted">
          {t("Crie os campos em Configurações → Funis. A resposta só grava quando o contato responde (não no timeout).")}
        </p>
      </div>
      {error && <p className="text-xs text-error-fg">{error}</p>}
    </div>
  );
}
