"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/hooks/i18n/useT";
import { apiClient } from "@/lib/api/client";

export function LeadNoteComposer({ leadId, pipelineId }: { leadId: string; pipelineId: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  async function save() {
    const trimmed = note.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await apiClient.post(`/api/v1/leads/${leadId}/notes`, { note: trimmed });
      setNote("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["timeline", leadId] }),
        queryClient.invalidateQueries({ queryKey: ["board", pipelineId] }),
      ]);
      toast.success(t("Nota adicionada"));
    } catch {
      toast.error(t("Não foi possível salvar a nota."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 border-b border-border py-3">
      <label htmlFor={`lead-note-${leadId}`} className="block text-xs font-medium">
        {t("Adicionar nota")}
      </label>
      <Textarea
        id={`lead-note-${leadId}`}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        disabled={saving}
        maxLength={2000}
        rows={3}
        placeholder={t("Registre a conversa ou o próximo passo")}
      />
      <Button type="button" size="sm" onClick={save} disabled={saving || !note.trim()}>
        {saving ? t("Salvando…") : t("Salvar nota")}
      </Button>
    </div>
  );
}
